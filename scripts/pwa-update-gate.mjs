#!/usr/bin/env node
// Two actual production builds, real service workers, disposable browser only.
import { chromium, expect } from '@playwright/test';
import { build } from 'vite';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'lal-pwa-gate-'));
const dirs = { a: join(temporary, 'a'), b: join(temporary, 'b') };
const emit = code => process.stdout.write(`${code}\n`);
const check = condition => { if (!condition) throw new Error('GATE_ASSERTION'); };
let stage = 'BUILD', current = 'a', browser, server;
const fixture = JSON.parse(await readFile(join(root, 'test/fixtures/backups/v1.json'), 'utf8'));
const images = JSON.parse(await readFile(join(root, 'test/fixtures/covers/synthetic.json'), 'utf8'));
const mediaId = 'a5f7ab9f-c2ed-4779-b274-f89ae62716ed';
fixture.books[0].cover = { provider: 'local', mediaId }; fixture.books[0].source = null;
fixture.coverMedia = [{ id: mediaId, mimeType: 'image/png', bytes: images['image/png'], width: 32, height: 48, createdAt: '2026-09-26T12:00:00Z' }];
async function snapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('livro-a-livro'); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    try {
      const tx = db.transaction(['books', 'coverMedia', 'preferences'], 'readonly');
      const read = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = reject; });
      const [books, media, preferences] = await Promise.all([read(tx.objectStore('books').getAll()), read(tx.objectStore('coverMedia').getAll()), read(tx.objectStore('preferences').get('ui'))]);
      return { books, preferences, media: await Promise.all(media.map(async item => ({ ...item, bytes: Array.from(new Uint8Array(await item.bytes.arrayBuffer())) }))) };
    } finally { db.close(); }
  });
}
const boots = page => page.evaluate(() => Number(sessionStorage.getItem('pwa-gate-boots')));
const ready = page => expect(page.getByText('Aplicativo disponível offline neste navegador.', { exact: true })).toBeVisible();
const version = (page, id) => expect(page.getByText(new RegExp(`build pwa-gate-${id}$`))).toBeVisible({ timeout: 30_000 });
async function waiting(page) {
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(true);
}
async function seed(page, origin) {
  await page.goto(`${origin}/#/dados`);
  await page.getByLabel('Importar JSON').setInputFiles({ name: 'synthetic-pwa.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.getByRole('button', { name: /^Substituir por/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: /^Substituir por/ }).click();
  await expect.poll(async () => (await snapshot(page)).books.length).toBe(1);
}
async function context(origin) {
  const result = await browser.newContext({ serviceWorkers: 'allow', locale: 'pt-BR' });
  await result.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await result.addInitScript(() => sessionStorage.setItem('pwa-gate-boots', String(Number(sessionStorage.getItem('pwa-gate-boots') ?? 0) + 1)));
  return result;
}
try {
  process.env.VITE_DRIVE_ENABLED = 'false'; process.env.VITE_LOCAL_MODE = 'false';
  for (const id of ['a', 'b']) await build({ root, logLevel: 'silent', define: { __BUILD_ID__: JSON.stringify(`pwa-gate-${id}`) }, build: { outDir: dirs[id] } });
  const initialHtml = await readFile(join(dirs.a, 'index.html'), 'utf8');
  const oldAsset = initialHtml.match(/src="(\/assets\/[^" ]+\.js)"/)[1];
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (!/^\/(?:|index\.html|sw\.js|privacidade\.html|manifest\.webmanifest|(?:assets|icons)\/[a-zA-Z0-9_.-]+)$/.test(path)) { response.writeHead(404).end(); return; }
    const name = path === '/' ? 'index.html' : path.slice(1);
    let body;
    try { body = await readFile(join(dirs[current], name)); }
    catch { try { if (!path.startsWith('/assets/')) throw new Error(); body = await readFile(join(dirs.a, name)); } catch { response.writeHead(404).end(); return; } }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' }[extname(name)] ?? 'application/octet-stream';
    response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'vary': 'Origin' }); response.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });

  stage = 'FIRST_INSTALL';
  const automatic = await context(origin); const page = await automatic.newPage();
  await page.goto(`${origin}/#/configuracoes`); await ready(page); await version(page, 'a');
  check(await boots(page) === 1); emit('FIRST_INSTALL_NO_RELOAD');
  await seed(page, origin); const original = await snapshot(page);
  await page.goto(`${origin}/#/configuracoes`); await version(page, 'a');
  const previousBoots = await boots(page);
  stage = 'AUTOMATIC_OPEN'; current = 'b'; await page.reload(); await version(page, 'b'); await ready(page);
  check(await boots(page) === previousBoots + 2); check(isDeepStrictEqual(original, await snapshot(page)));
  emit('OPEN_UPDATE_ONCE_LIBRARY_PRESERVED');
  stage = 'OFFLINE_NEW_AND_OLD_ASSETS'; await automatic.setOffline(true); await page.reload(); await version(page, 'b');
  check(isDeepStrictEqual(original, await snapshot(page)));
  check(await page.evaluate(async path => { const response = await fetch(path); return response.ok && response.headers.get('content-type')?.includes('javascript'); }, oldAsset));
  emit('UPDATED_OFFLINE_AND_OLD_CHUNKS_PASS'); await automatic.close();

  stage = 'DRAFT'; current = 'a'; const draftContext = await context(origin); const draft = await draftContext.newPage();
  await draft.goto(`${origin}/#/configuracoes`); await ready(draft); await draft.reload(); await ready(draft); await seed(draft, origin);
  await draft.goto(`${origin}/#/adicionar`); await draft.getByRole('button', { name: 'Adicionar manualmente', exact: true }).click();
  await draft.getByLabel('Título (obrigatório)', { exact: true }).fill('Livro sintético da atualização');
  const draftBoots = await boots(draft); current = 'b'; await waiting(draft);
  const update = draft.getByRole('button', { name: 'Atualizar aplicativo', exact: true });
  await expect(update).toBeVisible(); await expect(update).toBeDisabled();
  check(await boots(draft) === draftBoots);
  await expect(draft.getByLabel('Título (obrigatório)', { exact: true })).toHaveValue('Livro sintético da atualização');
  await draft.setViewportSize({ width: 320, height: 900 }); await draft.evaluate(() => window.scrollTo(0, 0));
  check(await draft.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check((await update.boundingBox()).y < 700);
  if (process.env.LAL_PWA_SCREENSHOT) await draft.screenshot({ path: resolve(process.env.LAL_PWA_SCREENSHOT) });
  await draft.getByRole('button', { name: 'Salvar livro', exact: true }).click();
  await expect(draft.getByRole('heading', { name: 'Livro sintético da atualização', exact: true })).toBeVisible();
  const saved = await snapshot(draft); await expect(update).toBeEnabled(); await update.click();
  await expect.poll(() => boots(draft)).toBe(draftBoots + 1);
  await draft.goto(`${origin}/#/configuracoes`); await version(draft, 'b');
  check(isDeepStrictEqual(saved, await snapshot(draft))); emit('DRAFT_SAVED_BEFORE_MANUAL_UPDATE_MOBILE_PASS'); await draftContext.close();

  stage = 'MULTI_TAB'; current = 'a'; const multi = await context(origin); const first = await multi.newPage();
  await first.goto(`${origin}/#/configuracoes`); await ready(first); await first.reload(); await ready(first); await seed(first, origin); const beforeMulti = await snapshot(first);
  await first.goto(`${origin}/#/configuracoes`); await first.keyboard.press('Tab');
  const second = await multi.newPage(); await second.goto(`${origin}/#/configuracoes`); await ready(second); await second.keyboard.press('Tab');
  const multiBoots = await boots(first); current = 'b'; await waiting(first); await first.bringToFront();
  await first.getByRole('button', { name: 'Atualizar aplicativo', exact: true }).click();
  await expect(first.getByText('Feche as outras abas e janelas do Livro a Livro antes de atualizar.', { exact: true })).toBeVisible();
  check(await boots(first) === multiBoots); await second.close();
  await first.getByRole('button', { name: 'Atualizar aplicativo', exact: true }).click(); await version(first, 'b');
  check(await boots(first) === multiBoots + 1); check(isDeepStrictEqual(beforeMulti, await snapshot(first)));
  emit('MULTI_TAB_REFUSAL_AND_RETRY_PASS'); await multi.close(); emit('PWA_UPDATE_GATE_PASS');
} catch { emit(`PWA_UPDATE_GATE_FAIL_${stage}`); process.exitCode = 1; }
finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true }); }
