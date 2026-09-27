import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalApi } from './local-api.mjs';

test('simulator stays loopback-only, rejects auth payloads and persists appData uploads without outbound network', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lal-local-test-')); const file = join(directory, 'state.json');
  const outbound = globalThis.fetch;
  // The server must not make any fetch call (Google, AWS or another host).
  globalThis.fetch = () => { throw new Error('external_network_forbidden'); };
  const server = await startLocalApi({ port: 0, file }); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(server.address().address, '127.0.0.1');
    assert.equal((await outbound(base + '/v1/session', { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await outbound(base + '/v1/auth/drive-token', { method: 'POST', body: JSON.stringify({ books: [] }) })).status, 400);
    const session = await (await outbound(base + '/v1/session')).json(); assert.equal(session.connectionId, 'local-test-connection');
    const headers = { Authorization: 'Bearer local-simulated-token', 'Content-Type': 'application/json' };
    const start = await outbound(base + '/upload/drive/v3/files', { method: 'POST', headers, body: JSON.stringify({ parents: ['appDataFolder'], appProperties: { protocolVersion: '1' } }) });
    const url = new URL(start.headers.get('location'));
    assert.equal(url.origin, 'https://www.googleapis.com');
    await outbound(base + url.pathname + url.search, { method: 'PUT', headers, body: JSON.stringify({ synthetic: true }) });
    const listing = await (await outbound(base + '/drive/v3/files', { headers })).json(); assert.equal(listing.files.length, 1);
    const data = await (await outbound(base + '/drive/v3/files/' + listing.files[0].id + '?alt=media', { headers })).json();
    assert.deepEqual(data, { synthetic: true });
    assert.equal(JSON.parse(await readFile(file, 'utf8')).snapshots.length, 1);
  } finally { globalThis.fetch = outbound; await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true }); }
});
