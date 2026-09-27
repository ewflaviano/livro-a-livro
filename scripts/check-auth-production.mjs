// Small control-plane smoke. Never log response bodies, cookies or OAuth values.
// Does not contact Google, grant access, upload a library or read an existing session.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';

const origin = 'https://livroalivro.app.br';
const api = 'https://api.livroalivro.app.br';
async function control(path, options = {}) {
  await pause(650); // Respect the production Gateway's small initial rate limit.
  return fetch(api + path, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000),
    ...options, headers: { Origin: origin, ...options.headers } });
}
try {
  const login = await control('/v1/login');
  assert.equal(login.status, 401);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  const authorization = await control('/v1/auth/google/authorization');
  assert.equal(authorization.status, 401);
  const session = await control('/v1/session');
  assert.equal(session.status, 401);
  assert.equal(session.headers.get('cache-control'), 'no-store');
  assert.equal(session.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(session.headers.get('access-control-allow-origin'), origin);
  assert.equal(session.headers.get('access-control-allow-credentials'), 'true');

  const driveWithoutLogin = await control('/v1/auth/google/drive/start', {
    method: 'POST', headers: { 'x-lal-attempt': randomUUID() },
  });
  assert.equal(driveWithoutLogin.status, 401);
  assert.equal((await control('/v1/login/renew', { method: 'POST' })).status, 401);
  assert.equal((await control('/v1/login', { method: 'DELETE' })).status, 401);

  const wrongOrigin = await control('/v1/session', { headers: { Origin: 'https://example.invalid' } });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.headers.get('access-control-allow-origin'), null);
  const body = await control('/v1/auth/google/start', { method: 'POST', body: '{}' });
  assert.equal(body.status, 400);
  const query = await control('/v1/session?unexpected=synthetic');
  assert.equal(query.status, 400);
  const preflight = await control('/v1/auth/drive-token', { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-lal-csrf',
  } });
  assert.equal(preflight.status, 204);
  const attemptPreflight = await control('/v1/auth/google/start', { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-lal-csrf,x-lal-attempt',
  } });
  assert.equal(attemptPreflight.status, 204);
  assert.ok(attemptPreflight.headers.get('access-control-allow-headers').toLowerCase().includes('x-lal-attempt'));

  const attemptId = randomUUID();
  const start = await control('/v1/auth/google/start', { method: 'POST', headers: { 'x-lal-attempt': attemptId } });
  assert.equal(start.status, 200);
  const raw = await start.text(); assert.ok(raw.length < 16_384);
  const url = new URL(JSON.parse(raw).authorizationUrl);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.pathname, '/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), '924461663769-hh13uavp9etgut330pq65uulsm84am9c.apps.googleusercontent.com');
  assert.equal(url.searchParams.get('redirect_uri'), api + '/v1/auth/google/callback');
  assert.equal(url.searchParams.get('scope'), 'openid');
  assert.equal(url.searchParams.get('access_type'), 'online');
  assert.equal(url.searchParams.get('prompt'), 'select_account');
  assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const cookie = start.headers.getSetCookie().find(value => value.startsWith('__Host-lal_oauth='));
  assert.match(cookie, /^__Host-lal_oauth=[A-Za-z0-9_-]{43};/);
  for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=600']) assert.ok(cookie.includes(attribute));
  assert.ok(!cookie.includes('Domain='));
  // Exercise only this newly created pending attempt; never borrow a browser session.
  const pendingCookie = cookie.split(';')[0];
  const pending = await control('/v1/auth/google/authorization', { headers: { Cookie: pendingCookie } });
  assert.equal(pending.status, 200);
  const pendingRaw = await pending.text(); assert.ok(pendingRaw.length < 16_384);
  const pendingData = JSON.parse(pendingRaw);
  assert.equal(pendingData.attemptId, attemptId);
  assert.equal(pendingData.purpose, 'signin');
  assert.ok(pendingData.expiresAt > Date.now() / 1000 && pendingData.expiresAt <= Date.now() / 1000 + 600);
  assert.ok(typeof pendingData.csrfToken === 'string' && pendingData.csrfToken.length > 0);
  const cancel = await control('/v1/auth/google/authorization', { method: 'DELETE', headers: {
    Cookie: pendingCookie, 'x-lal-csrf': pendingData.csrfToken, 'x-lal-attempt': attemptId,
  } });
  assert.equal(cancel.status, 204);
  assert.equal((await control('/v1/auth/google/authorization', { headers: { Cookie: pendingCookie } })).status, 401);
  const callback = await control('/v1/auth/google/callback?iss=https%3A%2F%2Faccounts.google.com&error=access_denied&state=synthetic-cancelled');
  assert.equal(callback.status, 401);
  assert.ok(callback.headers.get('content-type').startsWith('text/html'));
  const page = await callback.text();
  assert.ok(page.includes('https://livroalivro.app.br/#/dados'));
  assert.ok(!page.includes('synthetic-cancelled'));
  for (const issuer of ['', '&iss=https%3A%2F%2Fissuer.invalid']) {
    const invalidIssuer = await control('/v1/auth/google/callback?error=access_denied&state=synthetic-cancelled' + issuer);
    assert.equal(invalidIssuer.status, 400);
    assert.ok(!(await invalidIssuer.text()).includes('issuer.invalid'));
  }
  console.log('AUTH_PRODUCTION_CONTROL_GATE_PASS');
} catch {
  // Browser/HTTP assertion errors can contain credentials: emit no raw exception.
  console.error('AUTH_PRODUCTION_CONTROL_GATE_FAILED');
  process.exitCode = 1;
}
