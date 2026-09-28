// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const html = readFileSync('privacidade.html', 'utf8');
const document = new DOMParser().parseFromString(html, 'text/html');

it('offers unique, working section links without JavaScript', () => {
  expect(document.querySelector('script')).toBeNull();
  const links = [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Nesta página"] a')];
  expect(links.map(link => link.textContent?.trim())).toEqual([
    'Biblioteca', 'Google Drive', 'Prazos e remoção', 'Busca e capas', 'Analytics', 'Infraestrutura e terceiros', 'Contato',
  ]);
  const ids = [...document.querySelectorAll<HTMLElement>('[id]')].map(element => element.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const link of links) {
    expect(link.hash).toBeTruthy();
    expect(document.getElementById(link.hash.slice(1))?.tagName).toBe('H2');
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
    'não carrega o script do Analytics nem envia medições',
    'Open Library', '14 dias', 'ewanderson.flaviano@gmail.com',
  ]) expect(text).toContain(phrase);
});
