import { z } from 'zod';
import { canonicalJson, sameHeader, headerSchema, SyncError, type AuthClient, type Binding, type DriveClient, type DriveFile, type SyncSnapshot, type SnapshotHeader } from './contracts';
import { limitedJson, request } from './network';
import { MAX_SYNC_BYTES, parseSnapshot, libraryHashV2, remoteHeads } from './snapshot';
import type { LibraryExportV1 } from '../backup/schema';

const origin = 'https://www.googleapis.com';
const fileSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/u), size: z.string().regex(/^\d+$/u), appProperties: z.record(z.string(), z.string()) });
const pageSchema = z.object({ nextPageToken: z.string().max(4000).optional(), files: z.array(fileSchema).max(1000) });
const name = 'livro-a-livro-snapshot-v1.json';

export function createDriveClient(auth: AuthClient, binding: Binding, fetcher: typeof fetch = fetch): DriveClient {
  const resolutionHeaders = new Map<string, { metadata: string; header: SnapshotHeader }>();
  async function google(url: string, init: RequestInit, signal: AbortSignal) {
    const parsed = new URL(url);
    if (parsed.origin !== origin || parsed.username || parsed.password ||
      !['/drive/v3/files', '/upload/drive/v3/files'].some(path => parsed.pathname === path || parsed.pathname.startsWith(path + '/'))) throw new SyncError('invalid');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await request(fetcher, url, { ...init, signal, credentials: 'omit', headers: { ...init.headers,
          Authorization: `Bearer ${await auth.token(binding, signal)}` } });
      } catch (error) {
        if (!(error instanceof SyncError) || error.code !== 'reconnect' || attempt > 0) throw error;
        auth.invalidate();
      }
    }
    throw new SyncError('reconnect');
  }
  async function download(file: DriveFile, signal: AbortSignal) {
    if (file.size > MAX_SYNC_BYTES) throw new SyncError('invalid');
    const snapshot = await parseSnapshot(await limitedJson(await google(`${origin}/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`, {}, signal), MAX_SYNC_BYTES));
    const { library: _, ...header } = snapshot;
    if (header.protocolVersion !== file.header.protocolVersion || header.snapshotId !== file.header.snapshotId || header.hash !== file.header.hash || header.operationId !== file.header.operationId ||
      header.parentSnapshotId !== file.header.parentSnapshotId || header.createdAt !== file.header.createdAt ||
      file.resolution !== undefined && file.resolution !== (header.resolvedSnapshotIds.length > 0) ||
      file.header.resolvedSnapshotIds.length > 0 && !sameHeader(header, file.header)) throw new SyncError('invalid');
    return snapshot;
  }
  return {
    async list(signal) {
      const files: DriveFile[] = []; const tokens = new Set<string>(); let pageToken: string | undefined;
      do {
        const query = new URLSearchParams({ spaces: 'appDataFolder',
          q: `name = '${name}' and 'appDataFolder' in parents and trashed = false`,
          fields: 'nextPageToken,files(id,size,appProperties)', pageSize: '1000' });
        if (pageToken) query.set('pageToken', pageToken);
        const response = pageSchema.safeParse(await limitedJson(await google(`${origin}/drive/v3/files?${query}`, {}, signal), 2 * 1024 * 1024));
        if (!response.success) throw new SyncError('invalid');
        for (const raw of response.data.files) {
          const p = raw.appProperties;
          const parsed = headerSchema.safeParse({ format: 'livro-a-livro-sync', protocolVersion: Number(p.protocolVersion),
            snapshotId: p.snapshotId, operationId: p.operationId, parentSnapshotId: p.parentSnapshotId === 'root' ? null : p.parentSnapshotId,
            hash: p.hash, createdAt: p.createdAt, resolvedSnapshotIds: [] });
          if (!parsed.success || !['0', '1'].includes(p.resolution) || Number(raw.size) > MAX_SYNC_BYTES) throw new SyncError('invalid');
          const file: DriveFile = { id: raw.id, size: Number(raw.size), header: parsed.data, resolution: p.resolution === '1' };
          if (p.resolution === '1') {
            const metadata = canonicalJson(raw);
            const cached = resolutionHeaders.get(raw.id);
            let header = cached?.metadata === metadata ? cached.header : undefined;
            if (!header) {
              const { library: _, ...downloaded } = await download(file, signal);
              header = downloaded; resolutionHeaders.set(raw.id, { metadata, header });
            }
            file.header = header;
          }
          files.push(file);
        }
        if (files.length > 10_000) throw new SyncError('invalid');
        pageToken = response.data.nextPageToken;
        if (pageToken && tokens.has(pageToken)) throw new SyncError('invalid');
        if (pageToken) tokens.add(pageToken);
      } while (pageToken);
      remoteHeads(files); // Complete discovery must be valid before any decision.
      const seen = new Map<string, { file: DriveFile; digest?: string }>();
      for (const file of files) {
        const key = file.header.operationId.toLowerCase(); const previous = seen.get(key);
        if (!previous) { seen.set(key, { file }); continue; }
        if (!sameHeader(previous.file.header, file.header)) throw new SyncError('invalid');
        if (file.header.protocolVersion === 1) {
          previous.digest ??= await libraryHashV2((await download(previous.file, signal)).library as LibraryExportV1);
          if (previous.digest !== await libraryHashV2((await download(file, signal)).library as LibraryExportV1)) throw new SyncError('invalid');
        }
      }
      return files;
    },
    download,
    async upload(input: SyncSnapshot, signal) {
      const snapshot = await parseSnapshot(input);
      const content = JSON.stringify(snapshot);
      const metadata = { name, mimeType: 'application/json', parents: ['appDataFolder'], appProperties: {
        protocolVersion: String(snapshot.protocolVersion), snapshotId: snapshot.snapshotId, operationId: snapshot.operationId,
        parentSnapshotId: snapshot.parentSnapshotId ?? 'root', hash: snapshot.hash, createdAt: snapshot.createdAt,
        resolution: snapshot.resolvedSnapshotIds.length ? '1' : '0',
      } };
      // A new resumable session for each attempt. Reconcile operationId before retrying uploads.
      const start = await google(`${origin}/upload/drive/v3/files?uploadType=resumable&fields=id`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/json',
          'X-Upload-Content-Length': String(new TextEncoder().encode(content).length) }, body: JSON.stringify(metadata),
      }, signal);
      const location = start.headers.get('location');
      if (!location) throw new SyncError('invalid');
      // google() validates the exact HTTPS origin/path before adding a bearer token.
      await google(location, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: content }, signal);
    },
  };
}
