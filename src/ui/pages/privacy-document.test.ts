// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const html = readFileSync('privacidade.html', 'utf8');
const document = new DOMParser().parseFromString(html, 'text/html');
const english = new DOMParser().parseFromString(readFileSync('privacy.html', 'utf8'), 'text/html');

it('offers unique, working section links without JavaScript', () => {
  expect(document.querySelector('script')).toBeNull();
  const links = [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Nesta página"] a')];
  expect(links.map(link => link.textContent?.trim())).toEqual([
    'Biblioteca', 'Google Drive', 'Prazos e remoção', 'Busca e capas', 'Analytics', 'Diagnóstico de erros', 'Infraestrutura e terceiros', 'Contato',
  ]);
  const ids = [...document.querySelectorAll<HTMLElement>('[id]')].map(element => element.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const link of links) {
    expect(link.hash).toBeTruthy();
    expect(document.getElementById(link.hash.slice(1))?.tagName).toBe('H2');
  }
});

it('offers a complete English document with reciprocal static language links', () => {
  expect(document.documentElement.lang).toBe('pt-BR');
  expect(english.documentElement.lang).toBe('en');
  expect(english.querySelector('script')).toBeNull();
  expect(document.querySelector<HTMLAnchorElement>('header [hreflang="en"]')?.getAttribute('href')).toBe('/privacy.html');
  expect(english.querySelector<HTMLAnchorElement>('header [hreflang="pt-BR"]')?.getAttribute('href')).toBe('/privacidade.html');
  const links = [...english.querySelectorAll<HTMLAnchorElement>('nav.privacy-nav a')];
  expect(links).toHaveLength(8);
  const ids = [...english.querySelectorAll<HTMLElement>('[id]')].map(element => element.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const link of links) expect(english.getElementById(link.hash.slice(1))?.tagName).toBe('H2');
  const text = english.querySelector('main')?.textContent ?? '';
  for (const phrase of [
    'JSON backup', 'without accessing Drive', 'directly between the app in your browser and Google Drive',
    'does not receive books, notes, ratings, covers, snapshots, or backups',
    'Revoking access does not automatically delete copies', 'ten minutes', '30 days', '180 days', '24 hours',
    'does not load the Analytics script', 'same acceptance in the notice', 'Open Library', 'Google Books',
    'only when you click it', '14 days', 'ewanderson.flaviano@gmail.com',
  ]) expect(text).toContain(phrase);
});

it('keeps both install manifests on the same PWA identity and scope', () => {
  const portuguese = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  const englishManifest = JSON.parse(readFileSync('public/manifest-en.webmanifest', 'utf8'));
  expect(englishManifest.lang).toBe('en');
  expect(portuguese.lang).toBe('pt-BR');
  for (const key of ['id', 'start_url', 'scope', 'display', 'background_color', 'theme_color', 'icons']) {
    expect(englishManifest[key]).toEqual(portuguese[key]);
  }
});

it('retains the material privacy topics below the summary', () => {
  const summary = document.querySelector('.privacy-summary')?.textContent ?? '';
  expect(summary).toContain('backup JSON é criado aqui');
  expect(summary).toContain('uma cópia diretamente do aplicativo');
  expect(summary).toContain('buscas enviadas e capas externas');
  const text = document.querySelector('main')?.textContent ?? '';
  for (const phrase of [
    'sem acessar o Drive', 'diretamente entre o aplicativo no navegador e o Google Drive',
    'não recebe livros, notas, avaliações, capas, snapshots ou backups',
    'Revogar o acesso não significa apagar automaticamente cópias',
    'dez minutos', '30 dias', '180 dias', '24 horas',
    'não carrega o script do Analytics nem envia esses códigos',
    'uma escolha única para contar visitas', 'mesmo aceite do aviso permite',
    'Open Library', 'Pesquisar no Google Books', 'somente quando você clica', '14 dias', 'ewanderson.flaviano@gmail.com',
  ]) expect(text).toContain(phrase);
});
