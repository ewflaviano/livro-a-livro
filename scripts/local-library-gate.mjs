#!/usr/bin/env node
// Browser release gate with disposable profiles and synthetic books only.
import { chromium, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';

const origin = 'http://127.0.0.1:5197';
const images = JSON.parse(await readFile(new URL('../test/fixtures/covers/synthetic.json', import.meta.url), 'utf8'));
const emit = code => process.stdout.write(`${code}\n`);
const check = value => { if (!value) throw new Error('GATE_ASSERTION'); };
let stage = 'BUILD', browser, server;
try {
  execFileSync('npm', ['run', 'build'], { stdio: 'ignore', env: { ...process.env, VITE_DRIVE_ENABLED: 'false' } });
  server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '5197', '--strictPort'], { stdio: 'ignore' });
  let ready = false;
  for (let n = 0; n < 100; n++) { try { if ((await fetch(origin)).ok) { ready = true; break; } } catch {} await pause(100); }
  check(ready);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const makeContext = async () => {
    const context = await browser.newContext({ serviceWorkers: 'allow', acceptDownloads: true, locale: 'pt-BR', viewport: { width: 390, height: 844 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    return context;
  };
  const source = await makeContext();
  const page = await source.newPage();
  stage = 'CREATE';
  await page.goto(`${origin}/#/adicionar`);
  await page.getByRole('button', { name: 'Recusar', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar manualmente', exact: true }).click();
  await page.getByLabel('Título (obrigatório)', { exact: true }).fill('Livro sintético de navegação');
  await page.getByLabel('Autores (opcional, um por linha)').fill('Autoria sintética');
  await page.getByText('Mais detalhes (opcional)', { exact: true }).click();
  await page.getByLabel('Capa (opcional)').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(images['image/png'], 'base64') });
  await expect(page.getByText('Capa pronta para salvar:', { exact: false })).toBeVisible();
  await page.getByLabel('Observações').fill('Nota sintética privada');
  await page.getByRole('button', { name: 'Salvar livro', exact: true }).click();
  await expect(page.getByRole('link', { name: /Livro sintético de navegação/ })).toBeVisible();
  await page.getByRole('link', { name: /Livro sintético de navegação/ }).click();
  await expect(page.getByRole('heading', { name: 'Livro sintético de navegação' })).toBeVisible();
  await expect(page.locator('img.book-cover-image')).toBeVisible();
  stage = 'EDIT';
  await page.getByRole('button', { name: 'Editar livro', exact: true }).click();
  await page.getByLabel('Título (obrigatório)', { exact: true }).fill('Livro sintético editado');
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Livro sintético editado' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Livro sintético editado' })).toBeVisible();
  await expect(page.getByText('Nota sintética privada')).toBeVisible();
  emit('MANUAL_EDIT_COVER_PASS');
  stage = 'EXPORT';
  await page.goto(`${origin}/#/dados`);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Fazer backup', exact: true }).click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
  check(backup.books.length === 1 && backup.books[0].title === 'Livro sintético editado');
  check(backup.books[0].note === 'Nota sintética privada' && backup.coverMedia.length === 1);
  await source.close();
  stage = 'OFFLINE_RESTORE';
  const target = await makeContext();
  const restored = await target.newPage();
  await restored.goto(`${origin}/#/dados`);
  await restored.getByRole('button', { name: 'Recusar', exact: true }).click();
  await expect(restored.getByText('Aplicativo disponível offline neste navegador.', { exact: true })).toBeVisible({ timeout: 15_000 });
  await target.setOffline(true);
  await restored.reload();
  await expect(restored.getByRole('heading', { name: 'Seus dados' })).toBeVisible();
  await restored.getByRole('button', { name: 'Restaurar backup', exact: true }).click();
  await restored.getByLabel('Importar JSON').setInputFiles({ name: 'synthetic-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await restored.getByRole('button', { name: /^Substituir por 1 livro$/ }).click();
  await restored.getByRole('alertdialog').getByRole('button', { name: /^Substituir por 1 livro$/ }).click();
  await expect(restored.getByText('1 livro importado neste dispositivo.')).toBeVisible();
  await restored.goto(`${origin}/#/estante`);
  await expect(restored.getByRole('link', { name: /Livro sintético editado/ })).toBeVisible();
  await restored.getByRole('link', { name: /Livro sintético editado/ }).click();
  await expect(restored.getByText('Nota sintética privada')).toBeVisible();
  await expect(restored.locator('img.book-cover-image')).toBeVisible();
  check(await restored.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  emit('OFFLINE_RESTORE_SEPARATE_PROFILE_PASS');
  await target.close();
  emit('LOCAL_LIBRARY_GATE_PASS');
} catch (error) {
  if (process.env.LAL_GATE_DEBUG === 'true') console.error(error);
  emit(`LOCAL_LIBRARY_GATE_FAIL_${stage}`); process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) server.kill('SIGTERM');
}
