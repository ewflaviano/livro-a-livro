// Synthetic, bounded probe. Never print response bodies or request internals.
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';

const path = 'https://api.livroalivro.app.br/v1/diagnostics/errors';
const origin = 'https://livroalivro.app.br';
const request = async (options = {}) => {
  await pause(1200);
  return fetch(path, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    ...options, headers: { Origin: origin, ...options.headers } });
};
try {
  const preflight = await request({ method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
  const rejected = await request({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ area: 'runtime', code: 'render_failure', count: 1, message: 'synthetic-private' }) });
  assert.equal(rejected.status, 400);
  const accepted = await request({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ area: 'runtime', code: 'render_failure', count: 1 }) });
  assert.equal(accepted.status, 204);
  assert.equal(accepted.headers.get('access-control-allow-credentials'), null);
  const wrongOrigin = await request({ method: 'POST', headers: { Origin: 'https://example.invalid', 'content-type': 'application/json' }, body: JSON.stringify({ area: 'runtime', code: 'render_failure', count: 1 }) });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.headers.get('access-control-allow-origin'), null);
  console.log('DIAGNOSTICS_PRODUCTION_GATE_PASS');
} catch {
  console.error('DIAGNOSTICS_PRODUCTION_GATE_FAILED');
  process.exitCode = 1;
}
