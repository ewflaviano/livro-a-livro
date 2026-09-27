import { SyncError } from './contracts';

export async function limitedJson(response: Response, maximum: number): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > maximum || !response.body) throw new SyncError('invalid');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > maximum) throw new SyncError('invalid');
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw new SyncError('invalid'); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function checkedResponse(response: Response) {
  if (response.ok) return response;
  if (response.status === 401) throw new SyncError('reconnect');
  if (response.status === 429 || response.status >= 500) {
    const value = response.headers.get('retry-after') ?? '';
    const milliseconds = /^\d+$/u.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
    throw new SyncError('retry', Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0);
  }
  if (response.status === 403) {
    const payload = await limitedJson(response, 16 * 1024).catch(() => null) as { error?: string | { errors?: { reason?: string }[] } } | null;
    if (payload?.error === 'drive_authorization_required') throw new SyncError('drive-required');
    const reasons = typeof payload?.error === 'object' ? payload.error.errors?.map(error => error.reason) ?? [] : [];
    if (reasons.some(reason => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason ?? ''))) throw new SyncError('retry', 60_000);
    if (reasons.includes('storageQuotaExceeded')) throw new SyncError('quota');
    throw new SyncError('reconnect');
  }
  throw new SyncError('invalid');
}
export async function request(fetcher: typeof fetch, url: string, init: RequestInit) {
  try {
    return await checkedResponse(await fetcher(url, { ...init, redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) }));
  } catch (error) {
    if (init.signal?.aborted) throw new SyncError('cancelled');
    if (error instanceof SyncError) throw error;
    throw new SyncError('retry');
  }
}
