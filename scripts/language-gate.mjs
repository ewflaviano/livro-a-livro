#!/usr/bin/env node
// Two languages, one disposable browser origin, no real library or Google account.
import { chromium, expect } from '@playwright/test';
import { build } from 'vite';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = await mkdtemp(join(tmpdir(), 'lal-language-gate-'));
let browser, server, stage = 'BUILD';
try {
  process.env.VITE_DRIVE_ENABLED = 'false';
  await build({ root, logLevel: 'silent', build: { outDir: output } });
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (!/^\/(?:|index\.html|sw\.js|privacy\.html|privacidade\.html|manifest(?:-en)?\.webmanifest|favicon\.ico|(?:assets|icons)\/[a-zA-Z0-9_.-]+)$/.test(path)) {
      response.writeHead(404).end(); return;
    }
    const name = path === '/' ? 'index.html' : path.slice(1);
    try {
      const bytes = await readFile(join(output, name));
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
        '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }[extname(name)] ?? 'application/octet-stream';
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 320, height: 720 }, serviceWorkers: 'allow' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();

  stage = 'FIRST_VISIT';
  await page.goto(`${origin}/#/estante`);
  await expect(page.getByRole('heading', { name: 'Shelf', level: 1 })).toBeVisible();
  const prompt = page.locator('.language-choice-banner');
  await expect(prompt).toBeVisible();
  if (await page.locator('html').getAttribute('lang') !== 'en') throw new Error('HTML_LANG');
  if (await page.locator('link[rel=manifest]').getAttribute('href') !== '/manifest-en.webmanifest') throw new Error('MANIFEST_EN');
  if (await page.locator('footer a').first().getAttribute('href') !== '/privacy.html') throw new Error('PRIVACY_EN');
  const notice = page.getByRole('region', { name: 'App usage choice' });
  await expect(notice).toHaveCount(0);
  if (process.env.LAL_LANGUAGE_MOBILE_SCREENSHOT) await page.screenshot({ path: process.env.LAL_LANGUAGE_MOBILE_SCREENSHOT });
  await prompt.getByRole('button', { name: 'English' }).focus();
  if (await page.evaluate(() => document.activeElement?.textContent?.trim()) !== 'English') throw new Error('KEYBOARD_FOCUS');
  await prompt.getByRole('button', { name: 'English' }).click();
  await expect(prompt).toHaveCount(0);
  await expect(notice).toBeVisible();
  if (await notice.getByRole('link', { name: 'Learn more' }).getAttribute('href') !== '/privacy.html') throw new Error('CONSENT_PRIVACY_EN');
  await page.goto(`${origin}/#/configuracoes`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  if (await page.locator('link[rel=manifest]').getAttribute('href') !== '/manifest-en.webmanifest') throw new Error('RELOAD_MANIFEST');
  for (const [route, heading] of [
    ['estante', 'Shelf'], ['adicionar', 'Add book'], ['dados', 'Your data'],
    ['mais', 'More'], ['instalar', 'Install'], ['apoiar', 'Support Livro a Livro'], ['configuracoes', 'Settings'],
  ]) {
    await page.goto(`${origin}/#/${route}`);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error(`MOBILE_OVERFLOW_${route}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/#/estante`);
  await expect(page.getByRole('heading', { name: 'Shelf', level: 1 })).toBeVisible();
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('DESKTOP_OVERFLOW');
  if (process.env.LAL_LANGUAGE_DESKTOP_SCREENSHOT) await page.screenshot({ path: process.env.LAL_LANGUAGE_DESKTOP_SCREENSHOT });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(`${origin}/#/configuracoes`);
  process.stdout.write('EN_FIRST_VISIT_AND_RELOAD_PASS\n');

  stage = 'CROSS_TAB';
  const second = await context.newPage();
  await second.goto(`${origin}/#/configuracoes`);
  await expect(second.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await page.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'Português' }).click();
  await expect(page.getByRole('heading', { name: 'Configurações', level: 1 })).toBeVisible();
  if (await page.getByRole('region', { name: 'Escolha sobre uso do aplicativo' }).getByRole('link', { name: 'Saiba mais' }).getAttribute('href') !== '/privacidade.html') throw new Error('CONSENT_PRIVACY_PT');
  await expect(second.getByRole('heading', { name: 'Configurações', level: 1 })).toBeVisible();
  if (await second.locator('html').getAttribute('lang') !== 'pt-BR') throw new Error('CROSS_TAB_LANG');
  if (await second.locator('link[rel=manifest]').getAttribute('href') !== '/manifest.webmanifest') throw new Error('CROSS_TAB_MANIFEST');
  await second.close();
  process.stdout.write('CROSS_TAB_CHOICE_PASS\n');

  stage = 'OFFLINE';
  await expect(page.getByText('Aplicativo disponível offline neste navegador.', { exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Configurações', level: 1 })).toBeVisible();
  if (await page.locator('footer a').first().getAttribute('href') !== '/privacidade.html') throw new Error('OFFLINE_PRIVACY_LINK');
  await page.getByRole('group', { name: 'Idioma' }).getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  const policy = await page.evaluate(async () => (await fetch('/privacy.html')).text());
  if (!policy.includes('<html lang="en">')) throw new Error('OFFLINE_POLICY');
  process.stdout.write('OFFLINE_SWITCH_AND_POLICY_PASS\n');
  await context.close();
  process.stdout.write('LANGUAGE_GATE_PASS\n');
} catch (error) {
  if (process.env.LAL_GATE_DEBUG === 'true') console.error(error);
  process.stdout.write(`LANGUAGE_GATE_FAIL_${stage}\n`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(output, { recursive: true, force: true });
}
