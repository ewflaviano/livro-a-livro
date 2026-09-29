import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';

const origin = 'http://127.0.0.1:5196';
execFileSync('npm', ['run', 'build'], { stdio: 'ignore' });
const server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '5196', '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let n = 0; n < 100; n++) { try { const response = await fetch(origin); if (response.ok) { ready = true; break; } } catch {} await pause(100); }
  if (!ready) throw new Error('SERVER_UNAVAILABLE');
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 320, height: 844 } });
  const page = await context.newPage();
  const requests = [];
  page.on('request', request => { if (/googletagmanager\.com|google-analytics\.com/.test(request.url())) requests.push(request.url()); });
  await page.route('https://www.googletagmanager.com/gtag/js?**', route => route.fulfill({ contentType: 'text/javascript', body: `
    const queue = window.dataLayer; const original = queue.push.bind(queue);
    queue.push = function (...rows) { const result = original(...rows); for (const row of rows) if (row[0] === 'event' && row[1] === 'page_view') {
      const fields = row[2]; fetch('https://www.google-analytics.com/g/collect?dl=' + encodeURIComponent(fields.page_location) + '&dt=' + encodeURIComponent(fields.page_title));
    } return result; };
  ` }));
  await page.route('https://www.google-analytics.com/**', route => route.fulfill({ status: 204, body: '' }));
  await page.goto(`${origin}/#/dados`);
  await page.getByRole('button', { name: 'Recusar' }).waitFor();
  if (requests.length) throw new Error('PRECONSENT_REQUEST');
  if (process.env.LAL_GA_SCREENSHOT) await page.screenshot({ path: process.env.LAL_GA_SCREENSHOT });
  await page.getByRole('button', { name: 'Recusar' }).click();
  await page.reload();
  if (requests.length) throw new Error('REJECTION_REQUEST');
  await page.goto(`${origin}/#/configuracoes`);
  await page.getByRole('button', { name: 'Revisar escolha de uso do aplicativo' }).click();
  await page.getByRole('button', { name: 'Aceitar' }).click();
  await page.waitForFunction(() => window.dataLayer?.some(row => row[0] === 'event'));
  await page.waitForTimeout(150);
  const scripts = requests.filter(url => url.includes('googletagmanager.com'));
  const collects = requests.filter(url => url.includes('google-analytics.com'));
  if (scripts.length !== 1 || collects.length !== 1) throw new Error('ACCEPT_REQUEST_COUNT');
  const collect = new URL(collects[0]);
  if (collect.searchParams.get('dl') !== `${origin}/configuracoes` || collect.searchParams.get('dt') !== 'Configurações') throw new Error('UNSAFE_ROUTE');
  await page.evaluate(() => { document.cookie = '_ga=synthetic; Path=/'; document.cookie = '_ga_TEST=synthetic; Path=/'; });
  await page.reload(); await page.getByRole('button', { name: 'Revisar escolha de uso do aplicativo' }).waitFor();
  const retained = await context.cookies();
  if (!retained.some(cookie => cookie.name === '_ga' && cookie.value === 'synthetic')) throw new Error('ACCEPT_COOKIE_LOST');
  await page.getByRole('button', { name: 'Revisar escolha de uso do aplicativo' }).click();
  await page.getByRole('button', { name: 'Recusar' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Revisar escolha de uso do aplicativo' }).waitFor();
  const afterReopen = requests.length;
  if (afterReopen < 4 || requests.some(url => url.includes('google-analytics.com') && /[?#].*(?:secret|synthetic)/.test(url))) throw new Error('REOPEN_REQUEST');
  await page.waitForTimeout(150); if (requests.length !== afterReopen) throw new Error('POSTREVOCATION_REQUEST');
  const cookies = await context.cookies(); if (cookies.some(cookie => cookie.name === '_ga' || cookie.name.startsWith('_ga_'))) throw new Error('COOKIES_REMAIN');
  console.log('GA_CONSENT_GATE_PASS');
} finally { await browser?.close(); server.kill('SIGTERM'); }
