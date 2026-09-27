#!/usr/bin/env node
// Disposable, synthetic release gate. Never attach to an existing browser/profile.
import { chromium, expect } from '@playwright/test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { isDeepStrictEqual } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = 'https://livroalivro.app.br';
const api = 'https://api.livroalivro.app.br';
const smoke = process.argv.includes('--smoke');
const temporary = await mkdtemp(join(tmpdir(), 'lal-drive-gate-'));
const distArg = process.argv.indexOf('--dist');
const dist = distArg < 0 ? join(temporary, 'dist') : resolve(process.argv[distArg + 1]);
const emit = code => process.stdout.write(`${code}\n`);
const check = condition => { if (!condition) throw new Error('GATE_ASSERTION'); };
let publicHeaders = {};
let browser; let input; let violation = false; let stage = 'BUILD';
let smokeDrive = false;
const knownOperations = new Set(); const putCounts = new Map(); const listedOperations = new Map();
let lostPut = null; let gateSequence = 0;
const fakeDriveFiles = [];
let smokeRenewal = false; let syntheticSession = 'synthetic-old';
const offlineContexts = new WeakSet();
const contexts = {}; const pages = {}; const counters = { api: 0, drive: 0 };
const contextDriveCounts = new WeakMap(); const identityDriveBaseline = new Map();
const methods = new Map([
  ['/v1/auth/google/start', ['POST']], ['/v1/session', ['GET', 'DELETE']],
  ['/v1/auth/google/identity', ['GET', 'DELETE']], ['/v1/auth/google/drive/start', ['POST']],
  ['/v1/session/renew', ['POST']], ['/v1/auth/drive-token', ['POST']],
  ['/v1/drive-connection', ['DELETE']],
]);
const fixture = JSON.parse(await readFile(join(root, 'test/fixtures/backups/v1.json'), 'utf8'));
const images = JSON.parse(await readFile(join(root, 'test/fixtures/covers/synthetic.json'), 'utf8'));
const mediaId = 'a5f7ab9f-c2ed-4779-b274-f89ae62716ed';
fixture.books[0].cover = { provider: 'local', mediaId };
fixture.books[0].source = null;
fixture.coverMedia = [{ id: mediaId, mimeType: 'image/png', bytes: images['image/png'], width: 32, height: 48, createdAt: '2026-09-26T12:00:00Z' }];

function apiAllowed(request) {
  const url = new URL(request.url());
  if (request.postDataBuffer()?.length || url.username || url.password) return false;
  if (url.pathname === '/v1/auth/google/callback') {
    return request.method() === 'GET' && request.isNavigationRequest() &&
      [...url.searchParams.keys()].every(key => ['state', 'code', 'error', 'error_description', 'scope', 'authuser', 'prompt'].includes(key));
  }
  return !url.search && methods.has(url.pathname) &&
    (methods.get(url.pathname).includes(request.method()) || request.method() === 'OPTIONS');
}
async function routeRequest(route) {
  if (violation) return route.abort();
  const request = route.request(); const url = new URL(request.url());
  if (url.origin !== web && offlineContexts.has(request.frame().page().context())) return route.abort();
  if (url.origin === web) {
    const allowed = !url.search && (['/', '/index.html', '/privacidade.html', '/manifest.webmanifest'].includes(url.pathname) ||
      /^\/(assets|icons)\/[a-zA-Z0-9_.-]+$/.test(url.pathname));
    if (!allowed || request.method() !== 'GET') { violation = true; return route.abort(); }
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    try {
      const body = await readFile(join(dist, name));
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' }[extname(name)] || 'application/octet-stream';
      return route.fulfill({ status: 200, contentType: mime, headers: publicHeaders, body });
    } catch { violation = true; return route.abort(); }
  }
  if (url.origin === api) {
    if (!apiAllowed(request)) { violation = true; return route.abort(); }
    counters.api++;
    if (smoke && (smokeRenewal || smokeDrive)) {
      const headers = { 'access-control-allow-origin': web, 'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'x-lal-csrf', 'cache-control': 'no-store' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (smokeDrive && url.pathname === '/v1/auth/drive-token') return route.fulfill({ status: 200, headers, json: { accessToken: 'synthetic-drive-token', expiresIn: 3600, scopes: ['openid', 'https://www.googleapis.com/auth/drive.appdata'] } });
      const valid = smokeDrive || (await request.headerValue('cookie') ?? '').split(';').some(part => part.trim() === `__Host-lal_session=${syntheticSession}`);
      if (!valid) return route.fulfill({ status: 401, headers, json: { error: 'unauthorized' } });
      if (url.pathname === '/v1/session/renew' && request.method() === 'POST') {
        check(await request.headerValue('x-lal-csrf') === 'synthetic-csrf-old');
        syntheticSession = 'synthetic-new';
        return route.fulfill({ status: 200, headers: { ...headers, 'set-cookie': '__Host-lal_session=synthetic-new; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600' },
          json: { csrfToken: 'synthetic-csrf-new', expiresAt: 2000000000 } });
      }
      if (url.pathname === '/v1/session' && request.method() === 'GET') return route.fulfill({ status: 200, headers,
        json: { connectionId: 'synthetic-gate', generation: 1, csrfToken: syntheticSession === 'synthetic-old' ? 'synthetic-csrf-old' : 'synthetic-csrf-new', expiresAt: 2000000000,
          scopes: ['openid', 'https://www.googleapis.com/auth/drive.appdata'] } });
      violation = true; return route.abort();
    }
    return smoke ? route.abort() : route.continue();
  }
  if (url.origin === 'https://www.googleapis.com') {
    counters.drive++;
    const context = request.frame().page().context();
    contextDriveCounts.set(context, (contextDriveCounts.get(context) ?? 0) + 1);
    return driveRequest(route);
  }
  // Smoke mode is hermetic. Real mode leaves Google login/consent entirely to the human.
  return smoke ? route.abort() : route.continue();
}
function syntheticLibrary(library) {
  check(library?.books?.length === fixture.books.length && library.coverMedia?.length === fixture.coverMedia.length);
  for (const value of library.books) {
    const original = fixture.books.find(book => book.id === value.id); check(Boolean(original));
    const { note, updatedAt, ...rest } = value; const { note: originalNote, updatedAt: _, ...expected } = original;
    check(isDeepStrictEqual(rest, expected) && typeof updatedAt === 'string');
    check(note === originalNote || /^Gate sintético (A|B|PUT) [0-9]+$/.test(note));
  }
  check(isDeepStrictEqual(library.coverMedia, fixture.coverMedia) && isDeepStrictEqual(library.preferences, fixture.preferences));
}
async function driveRequest(route) {
  const request = route.request(); const url = new URL(request.url());
  try {
    check(!url.username && !url.password && ['/drive/v3/files', '/upload/drive/v3/files'].some(path => url.pathname === path || url.pathname.startsWith(`${path}/`)));
    if (smoke && !smokeDrive) return route.abort();
    let upload;
    if (request.method() === 'POST') {
      const metadata = request.postDataJSON();
      check(url.pathname === '/upload/drive/v3/files' && metadata.name === 'livro-a-livro-snapshot-v1.json' && metadata.parents?.[0] === 'appDataFolder');
      check(typeof metadata.appProperties?.operationId === 'string'); knownOperations.add(metadata.appProperties.operationId);
    }
    if (request.method() === 'PUT') {
      upload = request.postDataJSON(); syntheticLibrary(upload.library);
      check(knownOperations.has(upload.operationId));
      putCounts.set(upload.operationId, (putCounts.get(upload.operationId) ?? 0) + 1);
    }
    let response;
    if (smokeDrive) {
      const headers = { 'access-control-allow-origin': web, 'access-control-expose-headers': 'location', 'content-type': 'application/json' };
      if (request.method() === 'POST') response = { status: 200, headers: { ...headers, location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic' }, body: '{}' };
      else if (upload) {
        const id = `synthetic_${fakeDriveFiles.length + 1}`; fakeDriveFiles.push({ id, snapshot: upload });
        response = { status: 200, headers, body: JSON.stringify({ id }) };
      } else if (url.pathname === '/drive/v3/files') {
        response = { status: 200, headers, body: JSON.stringify({ files: fakeDriveFiles.map(({ id, snapshot }) => ({ id, size: String(Buffer.byteLength(JSON.stringify(snapshot))), appProperties: {
          protocolVersion: '1', snapshotId: snapshot.snapshotId, operationId: snapshot.operationId, parentSnapshotId: snapshot.parentSnapshotId ?? 'root', hash: snapshot.hash, createdAt: snapshot.createdAt, resolution: snapshot.resolvedSnapshotIds.length ? '1' : '0',
        } })) }) };
      } else {
        const file = fakeDriveFiles.find(file => url.pathname === `/drive/v3/files/${file.id}`); check(Boolean(file));
        response = { status: 200, headers, body: JSON.stringify(file.snapshot) };
      }
    } else {
      // Forward only the validated Drive request, never follow redirects with its bearer.
      const upstream = await route.fetch({ maxRedirects: 0, timeout: 30_000 });
      response = { status: upstream.status(), headers: upstream.headers(), body: await upstream.body() };
    }
    check(response.status < 300 || response.status >= 400);
    if (response.status >= 200 && response.status < 300) {
      if (request.method() === 'GET' && url.pathname === '/drive/v3/files') {
        const listing = JSON.parse(response.body.toString()); check(Array.isArray(listing.files) && !listing.nextPageToken);
        listedOperations.clear();
        for (const file of listing.files) {
          check(knownOperations.has(file.appProperties?.operationId));
          listedOperations.set(file.appProperties.operationId, (listedOperations.get(file.appProperties.operationId) ?? 0) + 1);
        }
      } else if (request.method() === 'GET') {
        const snapshot = JSON.parse(response.body.toString());
        check(knownOperations.has(snapshot.operationId)); syntheticLibrary(snapshot.library);
      }
      if (upload && lostPut) {
        const pending = lostPut; lostPut = null;
        await route.abort('failed'); pending.resolve(upload.operationId); return;
      }
    }
    return route.fulfill(response);
  } catch {
    violation = true; emit('UNKNOWN_OR_INVALID_REMOTE_STOP');
    lostPut?.reject(new Error('GATE_ASSERTION')); lostPut = null;
    return route.abort().catch(() => {});
  }
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('livro-a-livro'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('IDB')); });
    try {
      const tx = db.transaction(['books', 'coverMedia', 'preferences'], 'readonly');
      const read = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('IDB')); });
      const [books, media, prefs] = await Promise.all([read(tx.objectStore('books').getAll()), read(tx.objectStore('coverMedia').getAll()), read(tx.objectStore('preferences').get('ui'))]);
      const coverMedia = await Promise.all(media.map(async item => ({ ...item, bytes: Array.from(new Uint8Array(await item.bytes.arrayBuffer())) })));
      const { lastExport: _, ...preferences } = prefs;
      return { books: books.sort((a, b) => a.id.localeCompare(b.id)), coverMedia: coverMedia.sort((a, b) => a.id.localeCompare(b.id)), preferences };
    } finally { db.close(); }
  });
}
async function dataPage(page) { await page.bringToFront(); await page.goto(`${web}/#/dados`); await expect(page.getByRole('heading', { name: 'Seus dados', exact: true })).toBeVisible(); }
async function confirm(page) { await page.getByRole('alertdialog').getByRole('button', { name: 'Confirmar', exact: true }).click(); }
async function prepare() {
  stage = 'PREPARE';
  check(!pages.A);
  for (const id of ['A', 'B']) {
    const context = await browser.newContext({ serviceWorkers: 'block', locale: 'pt-BR', acceptDownloads: false });
    contexts[id] = context; await context.route('**/*', routeRequest);
    const page = await context.newPage(); pages[id] = page; page.setDefaultTimeout(30_000);
    page.on('framenavigated', frame => { if (frame === page.mainFrame() && new URL(frame.url()).origin === 'https://accounts.google.com') emit('READY_FOR_GOOGLE_CONSENT'); });
    stage = 'OPEN_DATA'; await dataPage(page);
    await expect(page.getByRole('button', { name: 'Entrar com Google', exact: true })).toBeVisible();
  }
  const page = pages.A;
  stage = 'IMPORT'; await page.getByLabel('Importar JSON').setInputFiles({ name: 'synthetic-gate.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  stage = 'IMPORT_PREVIEW'; await page.getByRole('button', { name: /^Substituir por/ }).click();
  stage = 'IMPORT_CONFIRM'; await page.getByRole('alertdialog').getByRole('button', { name: /^Substituir por/ }).click();
  stage = 'IMPORT_PERSISTED'; await expect.poll(async () => (await snapshot(page)).books.length).toBe(fixture.books.length);
  stage = 'IMPORT_EQUAL'; const result = await snapshot(page);
  check(isDeepStrictEqual(result.books, fixture.books));
  check(result.coverMedia.length === 1 && Buffer.from(result.coverMedia[0].bytes).equals(Buffer.from(images['image/png'], 'base64')));
  check((await snapshot(pages.B)).books.length === 0);
  emit('PREPARED_SYNTHETIC_CONTEXTS');
}
async function localControl(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('livro-a-livro'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('IDB')); });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('syncState', 'readonly').objectStore('syncState').get('control');
        request.onsuccess = () => resolve({ enabled: request.result?.enabled === true, revocationPending: request.result?.revocationPending === true });
        request.onerror = () => reject(new Error('IDB'));
      });
    } finally { db.close(); }
  });
}
async function pauseOrDisconnect(id, kind) {
  stage = 'LOCAL_DISCONNECT';
  const page = pages[id]; const before = await snapshot(page); await dataPage(page);
  const label = { pause: 'Pausar neste dispositivo', logout: 'Encerrar sessão neste dispositivo', revoke: 'Desconectar em todos os dispositivos' }[kind];
  stage = 'DISCONNECT_CLICK'; await page.getByRole('button', { name: label, exact: true }).click();
  stage = 'DISCONNECT_CONFIRM'; if (kind !== 'pause') await confirm(page);
  // Completion of a local command is distinct from Google's revocation acknowledgement.
  if (kind !== 'pause') await expect(page.getByRole('button', { name: label, exact: true })).toBeEnabled();
  else await expect(page.getByRole('button', { name: 'Retomar sincronização', exact: true })).toBeVisible();
  stage = 'DISCONNECT_STATE'; const control = await localControl(page); check(!control.enabled);
  if (control.revocationPending) {
    await expect(page.getByRole('heading', { name: 'Revogação no Google ainda não confirmada', exact: true })).toBeVisible();
  } else await expect(page.getByText('Sincronização pausada neste dispositivo.', { exact: false })).toBeVisible();
  check(isDeepStrictEqual(before, await snapshot(page)));
  stage = 'DISCONNECT_RELOAD'; await page.reload();
  const restored = await localControl(page); check(!restored.enabled && restored.revocationPending === control.revocationPending);
  if (restored.revocationPending) {
    await expect(page.getByRole('heading', { name: 'Revogação no Google ainda não confirmada', exact: true })).toBeVisible();
    emit('REVOCATION_UNCONFIRMED');
  } else await expect(page.getByRole('button', { name: 'Retomar sincronização', exact: true })).toBeVisible();
  check(isDeepStrictEqual(before, await snapshot(page)));
  emit('LOCAL_PRESERVED_AND_PAUSED');
}
async function setOffline(id, value) {
  if (value) offlineContexts.add(contexts[id]); else offlineContexts.delete(contexts[id]);
  await contexts[id].setOffline(value);
}
async function offlineCrud(id) {
  stage = 'OFFLINE_CRUD';
  const page = pages[id]; const before = await snapshot(page);
  await setOffline(id, true);
  try {
    stage = 'OFFLINE_ADD_PAGE';
    await page.goto(`${web}/#/adicionar`);
    await page.getByRole('button', { name: 'Adicionar manualmente', exact: true }).click();
    stage = 'OFFLINE_SAVE';
    await page.getByLabel('Título (obrigatório)', { exact: true }).fill('Gate sintético offline');
    await page.getByLabel('Ano da estante', { exact: false }).fill('2026');
    await page.getByRole('button', { name: 'Salvar livro', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Editar livro', exact: true })).toBeVisible();
    stage = 'OFFLINE_EDIT';
    await page.getByRole('button', { name: 'Editar livro', exact: true }).click();
    await page.getByLabel('Título (obrigatório)', { exact: true }).fill('Gate sintético offline editado');
    await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Gate sintético offline editado', exact: true })).toBeVisible();
    stage = 'OFFLINE_DELETE';
    await page.getByRole('button', { name: 'Remover livro', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir livro', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).books.length).toBe(before.books.length);
    stage = 'OFFLINE_EQUAL';
    check(isDeepStrictEqual(before, await snapshot(page)));
    emit('OFFLINE_CRUD_PRESERVED');
  } finally { await setOffline(id, false); await dataPage(page); }
}
async function renewSession(id) {
  stage = 'SESSION_RENEW';
  const page = pages[id]; const context = contexts[id];
  const beforeLibrary = await snapshot(page);
  const control = await localControl(page); check(!control.revocationPending);
  // Keep the app coordinator from racing the deliberate cookie rotation.
  if (control.enabled) await pauseOrDisconnect(id, 'pause');
  await dataPage(page);
  const oldCookie = (await context.cookies(api)).find(cookie => cookie.name === '__Host-lal_session');
  const validCookie = cookie => cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Lax' &&
    cookie.path === '/' && cookie.domain === 'api.livroalivro.app.br';
  check(validCookie(oldCookie));
  const proof = await page.evaluate(async origin => {
    const options = { credentials: 'include', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' };
    const before = await fetch(`${origin}/v1/session`, options);
    if (before.status !== 200) return false;
    const prior = await before.json();
    if (typeof prior.csrfToken !== 'string' || !prior.csrfToken) return false;
    const response = await fetch(`${origin}/v1/session/renew`, { ...options, method: 'POST', headers: { 'x-lal-csrf': prior.csrfToken } });
    if (response.status !== 200) return false;
    const renewed = await response.json();
    const after = await fetch(`${origin}/v1/session`, options);
    if (after.status !== 200) return false;
    const current = await after.json();
    return typeof renewed.csrfToken === 'string' && renewed.csrfToken.length > 0 &&
      renewed.csrfToken !== prior.csrfToken && current.csrfToken === renewed.csrfToken &&
      current.connectionId === prior.connectionId && current.generation === prior.generation &&
      Number.isFinite(renewed.expiresAt) && renewed.expiresAt > Date.now() / 1000 &&
      current.expiresAt === renewed.expiresAt;
  }, api);
  check(proof);
  const newCookie = (await context.cookies(api)).find(cookie => cookie.name === '__Host-lal_session');
  check(validCookie(newCookie) && newCookie.value !== oldCookie.value);
  const probe = await browser.newContext({ serviceWorkers: 'block', locale: 'pt-BR', acceptDownloads: false });
  try {
    await probe.route('**/*', routeRequest);
    // Copy only this disposable test cookie, never the Google login cookies or a storageState.
    await probe.addCookies([oldCookie]);
    const oldPage = await probe.newPage(); await dataPage(oldPage);
    const rejected = await oldPage.evaluate(async origin => {
      const response = await fetch(`${origin}/v1/session`, { credentials: 'include', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
      return response.status === 401;
    }, api);
    check(rejected);
    check(isDeepStrictEqual(beforeLibrary, await snapshot(page)) && !violation);
    emit('SESSION_ROTATED_OLD_COOKIE_REJECTED');
  } finally { await probe.close(); await page.bringToFront(); }
}
async function waitLeaseReleased(page) {
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('livro-a-livro'); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
    try { return await new Promise((resolve, reject) => { const r = db.transaction('syncState').objectStore('syncState').get('lease'); r.onsuccess = () => resolve(!r.result || r.result.until <= Date.now()); r.onerror = reject; }); }
    finally { db.close(); }
  }), { timeout: 50_000 }).toBe(true);
}
async function synced(id) {
  await dataPage(pages[id]);
  try { await expect(pages[id].getByText('Cópia confirmada no Google Drive.', { exact: false })).toBeVisible({ timeout: smoke ? 10_000 : 120_000 }); }
  catch (error) {
    for (const [code, text] of [['CONFLICT', 'Escolher uma versão'], ['ERROR', 'Não foi possível sincronizar. Seus dados locais continuam aqui.'], ['OFFLINE', 'Salvo aqui. Aguardando conexão para sincronizar.'], ['PENDING', 'Salvo aqui. Alterações aguardando envio ao Drive.'], ['RECONNECT', 'Reconecte o Google Drive para continuar os envios. Seus dados locais continuam aqui.']]) {
      if (await pages[id].getByText(text, { exact: true }).isVisible()) emit(`SYNC_STATE_${code}`);
    }
    throw error;
  }
  await waitLeaseReleased(pages[id]); check(!violation);
}
async function editSyntheticNote(id, label) {
  const page = pages[id]; await page.bringToFront();
  await page.goto(`${web}/#/livro/${fixture.books[0].id}`);
  stage = 'EDIT_OPEN'; await page.getByRole('button', { name: 'Editar livro', exact: true }).click();
  stage = 'EDIT_DETAILS'; await page.locator('textarea[name="note"]').waitFor({ state: 'attached' }); if (!await page.locator('textarea[name="note"]').isVisible()) await page.locator('details').filter({ has: page.locator('textarea[name="note"]') }).locator('summary').click();
  stage = 'EDIT_NOTE'; await page.locator('textarea[name="note"]').fill(label);
  stage = 'EDIT_SAVE'; await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  stage = 'EDIT_SAVED'; await expect(page.getByRole('button', { name: 'Editar livro', exact: true })).toBeVisible();
}
async function recovery(page) {
  const library = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('livro-a-livro'); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
    try { return await new Promise((resolve, reject) => { const r = db.transaction('syncState').objectStore('syncState').get('recovery'); r.onsuccess = () => resolve(r.result?.library); r.onerror = reject; }); }
    finally { db.close(); }
  });
  syntheticLibrary(library);
  return { books: library.books.sort((a, b) => a.id.localeCompare(b.id)), preferences: library.preferences,
    coverMedia: library.coverMedia.map(item => ({ ...item, bytes: Array.from(Buffer.from(item.bytes, 'base64')) })).sort((a, b) => a.id.localeCompare(b.id)) };
}
async function conflictGate() {
  stage = 'DIVERGENT_CONFLICT';
  stage = 'CONFLICT_BASE_SYNC'; await pages.A.reload(); await synced('A'); await pages.B.reload(); await synced('B');
  stage = 'CONFLICT_BASE_EQUAL'; check(isDeepStrictEqual(await snapshot(pages.A), await snapshot(pages.B)));
  check((await localControl(pages.A)).enabled && (await localControl(pages.B)).enabled);
  await pauseOrDisconnect('A', 'pause'); await pauseOrDisconnect('B', 'pause');
  await setOffline('A', true); await setOffline('B', true);
  try {
    const sequence = ++gateSequence;
    stage = 'CONFLICT_EDIT_A'; await editSyntheticNote('A', `Gate sintético A ${sequence}`);
    stage = 'CONFLICT_EDIT_B'; await editSyntheticNote('B', `Gate sintético B ${sequence}`);
    const a = await snapshot(pages.A); const b = await snapshot(pages.B); check(!isDeepStrictEqual(a, b));
    stage = 'CONFLICT_SYNC_A'; await setOffline('A', false); await dataPage(pages.A); await pages.A.getByRole('button', { name: 'Retomar sincronização', exact: true }).click(); await synced('A');
    stage = 'CONFLICT_REQUIRE_B'; await setOffline('B', false); await dataPage(pages.B); await pages.B.getByRole('button', { name: 'Retomar sincronização', exact: true }).click();
    await expect(pages.B.getByRole('heading', { name: 'Escolher uma versão', exact: true })).toBeVisible({ timeout: smoke ? 10_000 : 120_000 });
    check(isDeepStrictEqual(b, await snapshot(pages.B)));
    const choice = pages.B.getByRole('button', { name: 'Usar esta versão do Drive', exact: true }); check(await choice.count() === 1);
    stage = 'CONFLICT_CHOICE'; await choice.click(); await confirm(pages.B); await synced('B');
    stage = 'CONFLICT_RECOVERY'; check(isDeepStrictEqual(a, await snapshot(pages.B)) && isDeepStrictEqual(b, await recovery(pages.B)));
    await pages.A.reload(); await synced('A'); check(isDeepStrictEqual(await snapshot(pages.A), await snapshot(pages.B)));
    emit('DIVERGENT_CONFLICT_RECOVERY_PASS');
  } finally { await setOffline('A', false); await setOffline('B', false); }
}
async function lostPutGate(id) {
  stage = 'LOST_PUT'; await synced(id); check(!lostPut);
  let timeout;
  const accepted = new Promise((resolve, reject) => { lostPut = { resolve, reject }; timeout = setTimeout(() => reject(new Error('GATE_TIMEOUT')), 120_000); });
  // Attach a rejection handler immediately while UI editing is still in progress.
  void accepted.catch(() => {});
  try {
    await editSyntheticNote(id, `Gate sintético PUT ${++gateSequence}`);
    const expected = await snapshot(pages[id]);
    const operation = await accepted; clearTimeout(timeout);
    await waitLeaseReleased(pages[id]);
    await pages[id].close(); // Preserve cookies + IndexedDB, discard in-flight client state.
    pages[id] = await contexts[id].newPage(); pages[id].setDefaultTimeout(30_000);
    await synced(id);
    check(putCounts.get(operation) === 1 && listedOperations.get(operation) === 1);
    check(isDeepStrictEqual(expected, await snapshot(pages[id])) && !violation);
    emit('LOST_PUT_RECONCILED_WITHOUT_DUPLICATE');
  } finally { clearTimeout(timeout); lostPut = null; }
}
async function command(line) {
  const [name, id] = line.trim().split(/\s+/);
  if (name === 'prepare') return prepare();
  if (name === 'conflict') return conflictGate();
  if (name === 'audit') { check(!violation); emit('API_BOUNDARY_PASS'); return; }
  if (name === 'compare') { check(isDeepStrictEqual(await snapshot(pages.A), await snapshot(pages.B))); emit('CONTEXTS_EQUAL'); return; }
  check(['A', 'B'].includes(id) && pages[id]); const page = pages[id];
  if (name === 'signin') {
    await dataPage(page);
    identityDriveBaseline.set(id, contextDriveCounts.get(contexts[id]) ?? 0);
    await page.getByRole('button', { name: 'Entrar com Google', exact: true }).click(); await confirm(page); return;
  }
  if (name === 'identity') {
    // Human has returned from Google. Merely checking identity must never start Drive.
    check(identityDriveBaseline.has(id));
    const beforeDrive = identityDriveBaseline.get(id);
    await dataPage(page);
    await expect(page.getByRole('button', { name: 'Autorizar Google Drive', exact: true })).toBeVisible();
    check(!(await localControl(page)).enabled && (contextDriveCounts.get(contexts[id]) ?? 0) === beforeDrive);
    const status = await page.evaluate(async api => (await fetch(api + '/v1/session', { credentials: 'include', cache: 'no-store' })).status, api);
    check(status === 401 && (contextDriveCounts.get(contexts[id]) ?? 0) === beforeDrive);
    emit('IDENTITY_ONLY_NO_DRIVE_SESSION'); return;
  }
  if (name === 'authorize') { await page.getByRole('button', { name: 'Autorizar Google Drive', exact: true }).click(); await confirm(page); return; }
  if (name === 'synced') { await expect(page.getByText('Cópia confirmada no Google Drive.', { exact: false })).toBeVisible({ timeout: smoke ? 10_000 : 120_000 }); emit('DRIVE_CONFIRMED'); return; }
  if (name === 'remote') { await expect(page.getByRole('heading', { name: 'Escolher uma versão', exact: true })).toBeVisible(); const buttons = page.getByRole('button', { name: 'Usar esta versão do Drive', exact: true }); check(await buttons.count() === 1); await buttons.click(); await confirm(page); return; }
  if (['pause', 'logout', 'revoke'].includes(name)) return pauseOrDisconnect(id, name);
  if (name === 'resume') { await page.getByRole('button', { name: 'Retomar sincronização', exact: true }).click(); return; }
  if (name === 'offline-crud') return offlineCrud(id);
  if (name === 'renew') return renewSession(id);
  if (name === 'lost-put') return lostPutGate(id);
  if (name === 'reconnect-required') { await page.reload(); await expect(page.getByRole('button', { name: 'Entrar com Google', exact: true })).toBeVisible(); emit('RECONNECT_REQUIRED'); return; }
  throw new Error('UNKNOWN_COMMAND');
}
try {
  if (smoke) {
    const template = await readFile(join(root, 'infra/frontend.yml'), 'utf8');
    const csp = template.match(/ContentSecurityPolicy: "([^"\n]+)"/); check(Boolean(csp));
    publicHeaders = { 'content-security-policy': csp[1], 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
  } else {
    const response = await fetch(web, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) });
    check(response.status === 200);
    for (const name of ['content-security-policy', 'x-content-type-options', 'referrer-policy']) {
      const value = response.headers.get(name); check(Boolean(value)); publicHeaders[name] = value;
    }
    await response.body?.cancel();
  }
  if (distArg < 0) execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dist], { cwd: root, env: { ...process.env, VITE_DRIVE_ENABLED: 'true', VITE_LOCAL_MODE: 'false' }, stdio: 'ignore' });
  browser = await chromium.launch({ headless: smoke, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  if (smoke) {
    await prepare(); await offlineCrud('A'); check(counters.api === 0 && counters.drive === 0 && !violation);
    // Expose the disconnect controls with synthetic local state; API remains unreachable.
    await pages.A.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('livro-a-livro'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('IDB')); });
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('syncState', 'readwrite');
          tx.objectStore('syncState').put({ enabled: false, binding: { connectionId: 'synthetic-gate', generation: 1 }, base: null, attempts: 0, nextAttempt: 0, lastSyncedAt: null, revocationPending: false }, 'control');
          tx.oncomplete = resolve; tx.onerror = () => reject(new Error('IDB'));
        });
      } finally { db.close(); }
    });
    await pages.A.reload(); await dataPage(pages.A); await pauseOrDisconnect('A', 'revoke');
    check((await localControl(pages.A)).revocationPending && counters.api > 0 && counters.drive === 0 && !violation);
    smokeRenewal = true;
    try {
      await contexts.B.addCookies([{ name: '__Host-lal_session', value: 'synthetic-old', url: api, secure: true, httpOnly: true, sameSite: 'Lax' }]);
      await renewSession('B');
    } finally { smokeRenewal = false; }
    smokeDrive = true;
    for (const id of ['A', 'B']) {
      await pages[id].evaluate(async () => {
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open('livro-a-livro'); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
        try { await new Promise((resolve, reject) => { const tx = db.transaction('syncState', 'readwrite'); tx.objectStore('syncState').put({ enabled: true, binding: null, base: null, attempts: 0, nextAttempt: 0, lastSyncedAt: null, revocationPending: false }, 'control'); tx.oncomplete = resolve; tx.onerror = reject; }); }
        finally { db.close(); }
      });
    }
    await pages.A.reload(); await synced('A');
    await pages.B.reload(); await dataPage(pages.B);
    await pages.B.getByRole('button', { name: 'Usar esta versão do Drive', exact: true }).click(); await confirm(pages.B); await synced('B');
    await conflictGate(); await lostPutGate('A'); smokeDrive = false;
    const invalid = { url: () => `${api}/v1/session`, method: () => 'POST', postDataBuffer: () => Buffer.from('synthetic'), isNavigationRequest: () => false };
    check(!apiAllowed(invalid)); check(!apiAllowed({ ...invalid, postDataBuffer: () => null, method: () => 'GET', url: () => `${api}/v1/session?library=synthetic` }));
    emit('SMOKE_PASS');
  } else {
    emit('GATE_READY');
    input = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    for await (const line of input) {
      if (line.trim() === 'quit') break;
      try { await command(line); check(!violation); emit('COMMAND_PASS'); }
      catch { process.exitCode = 1; emit('COMMAND_FAILED'); if (violation) { emit('API_OR_ASSET_BOUNDARY_FAILED'); break; } }
    }
  }
} catch { emit(`GATE_FAILED_${stage}`); process.exitCode = 1; }
finally { input?.close(); await browser?.close(); await rm(temporary, { recursive: true, force: true }); }
