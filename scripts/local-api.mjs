import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultFile = resolve(root, '.local/livro-a-livro/drive-state.json');
const scope = ['openid', 'https://www.googleapis.com/auth/drive.appdata'];
const maxBytes = 50 * 1024 * 1024 + 65536;
export async function startLocalApi({ port = 8788, file = defaultFile } = {}) {
  let state = { generation: 1, snapshots: [] }; const uploads = new Map();
  // Deliberately synthetic single-user simulation; in-memory login survives page reload, never server restart. No Google credentials.
  let login = null; let attempt = null; let connected = false;
  try { state = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let saveQueue = Promise.resolve();
  const save = () => { const content = JSON.stringify(state); saveQueue = saveQueue.then(async () => {
    await mkdir(dirname(file), { recursive: true }); await writeFile(file + '.tmp', content, { mode: 0o600 }); await rename(file + '.tmp', file);
  }); return saveQueue; };
  const server = createServer(async (req, res) => {
    const host = `127.0.0.1:${server.address().port}`;
    const allowed = [`http://127.0.0.1:${Number(process.env.LIVRO_LOCAL_APP_PORT || 5173)}`];
    if (req.headers.host !== host || (req.headers.origin && !allowed.includes(req.headers.origin))) { res.writeHead(403); res.end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers.origin) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,x-lal-csrf,x-lal-attempt,X-Upload-Content-Type,X-Upload-Content-Length');
    res.setHeader('Access-Control-Expose-Headers', 'Location,Retry-After');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, `http://${host}`); const path = url.pathname;
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > maxBytes) { json(413, { code: 'too_large' }); req.destroy(); return; } chunks.push(chunk); }
      const body = Buffer.concat(chunks).toString('utf8');
      // Auth/control endpoints reject library bodies just like the real API.
      if ((path.startsWith('/v1/')) && body) { json(400, { code: 'body_not_allowed' }); return; }
      if (path.startsWith('/v1/') && url.search) return json(400, { code: 'query_not_allowed' });
      if (path === '/__local/health' && req.method === 'GET') return json(200, { local: true });
      const now = Math.floor(Date.now() / 1000);
      const uuid = req.headers['x-lal-attempt'];
      const validId = typeof uuid === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
      if (login && Math.min(login.expiresAt, login.absoluteExpiresAt) <= now) { login = null; connected = false; }
      if (path === '/v1/auth/google/start' && req.method === 'POST') {
        if (!validId) return json(400, { error: 'invalid_attempt' });
        if (login && req.headers['x-lal-csrf'] !== 'local-login-csrf') return json(403, { error: 'forbidden' });
        connected = false;
        login = { connectionId: 'local-test-connection', signInAttemptId: uuid, expiresAt: now + 30 * 86400, absoluteExpiresAt: now + 180 * 86400, csrfToken: 'local-login-csrf' };
        attempt = { attemptId: uuid, purpose: 'signin', expiresAt: now + 600, csrfToken: 'local-cancel-csrf' };
        return json(200, { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?scope=openid&local=true' });
      }
      if (path === '/v1/auth/google/authorization') {
        if (!attempt || attempt.expiresAt <= now) return json(401, { error: 'unauthorized' });
        if (req.method === 'GET') return json(200, attempt);
        if (req.method === 'DELETE') {
          if (req.headers['x-lal-csrf'] !== attempt.csrfToken || uuid !== attempt.attemptId) return json(403, { error: 'forbidden' });
          if (attempt.purpose === 'signin') login = null;
          connected = false; attempt = null; res.writeHead(204); res.end(); return;
        }
      }
      if (path.startsWith('/v1/auth/google/identity')) return json(401, { error: 'legacy_authorization' });
      if (path === '/v1/login' || path === '/v1/login/renew') {
        if (!login) return json(401, { error: 'unauthorized' });
        if (path === '/v1/login' && req.method === 'GET') return json(200, login);
        if (req.headers['x-lal-csrf'] !== login.csrfToken) return json(403, { error: 'forbidden' });
        if (req.method === 'DELETE') { login = null; connected = false; attempt = null; res.writeHead(204); res.end(); return; }
        if (path.endsWith('/renew') && req.method === 'POST') {
          login.expiresAt = Math.min(now + 30 * 86400, login.absoluteExpiresAt);
          return json(200, { expiresAt: login.expiresAt, absoluteExpiresAt: login.absoluteExpiresAt, csrfToken: login.csrfToken });
        }
      }
      if (path === '/v1/auth/google/drive/start' && req.method === 'POST') {
        if (!login) return json(401, { error: 'unauthorized' });
        if (!validId || req.headers['x-lal-csrf'] !== login.csrfToken) return json(403, { error: 'forbidden' });
        attempt = { attemptId: uuid, purpose: 'drive', expiresAt: Math.min(now + 600, login.expiresAt), csrfToken: 'local-cancel-csrf' };
        connected = true;
        return json(200, { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?scope=openid%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.appdata&local=true' });
      }
      if (path === '/v1/auth/drive-token' && login && !connected) return json(403, { error: 'drive_authorization_required' });
      if (path.startsWith('/v1/') && !connected) return json(401, { code: 'unauthorized' });
      if (path === '/v1/session' && req.method === 'GET') return json(200, { connectionId: 'local-test-connection', generation: state.generation, expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400, csrfToken: 'local-csrf', scopes: scope });
      if (path.startsWith('/v1/') && req.headers['x-lal-csrf'] !== 'local-csrf') return json(403, { code: 'forbidden' });
      if (path === '/v1/session/renew' && req.method === 'POST') return json(200, { expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400, csrfToken: 'local-csrf' });
      if (path === '/v1/auth/drive-token' && req.method === 'POST') return json(200, { accessToken: 'local-simulated-token', expiresIn: 3600, scopes: scope });
      if (path === '/v1/session' && req.method === 'DELETE') { connected = false; res.writeHead(204); res.end(); return; }
      if (path === '/v1/drive-connection' && req.method === 'DELETE') { connected = false; state.generation++; await save(); return json(200, { disconnected: true, revocationPending: false }); }
      if (!path.startsWith('/drive/v3/files') && !path.startsWith('/upload/drive/v3/files')) return json(404, { code: 'not_found' });
      if (req.headers.authorization !== 'Bearer local-simulated-token') return json(401, { code: 'unauthorized' });
      if (path === '/drive/v3/files' && req.method === 'GET') {
        const offset = Number(url.searchParams.get('pageToken') || 0);
        const files = state.snapshots.slice(offset, offset + 1000).map(({ id, content, metadata }) => ({ id, size: String(Buffer.byteLength(content)), appProperties: metadata.appProperties }));
        return json(200, { files, ...(offset + 1000 < state.snapshots.length ? { nextPageToken: String(offset + 1000) } : {}) });
      }
      if (path.startsWith('/drive/v3/files/') && req.method === 'GET') {
        const item = state.snapshots.find(item => item.id === path.split('/').pop());
        if (!item) return json(404, { code: 'not_found' });
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(item.content); return;
      }
      if (path === '/upload/drive/v3/files' && req.method === 'POST') {
        const metadata = JSON.parse(body);
        if (JSON.stringify(metadata.parents) !== '["appDataFolder"]') return json(400, { code: 'appdata_required' });
        const id = randomUUID(); uploads.set(id, metadata);
        res.setHeader('Location', `https://www.googleapis.com/upload/drive/v3/files?upload_id=${id}`);
        return json(200, {});
      }
      if (path === '/upload/drive/v3/files' && req.method === 'PUT') {
        const id = url.searchParams.get('upload_id'); const metadata = uploads.get(id);
        if (!metadata) return json(404, { code: 'session_expired' });
        JSON.parse(body); state.snapshots.push({ id, metadata, content: body }); uploads.delete(id); await save(); return json(200, { id });
      }
      return json(404, { code: 'not_found' });
    } catch { if (!res.headersSent) json(500, { code: 'local_error' }); else res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.LIVRO_LOCAL_API_PORT || 8788);
  await startLocalApi({ port });
  console.log(`Simulador local Livro a Livro: http://127.0.0.1:${port}. Somente dados descartáveis; nenhum Google/AWS.`);
}
