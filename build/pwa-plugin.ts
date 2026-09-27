import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

// Exact public allowlist; never scan arbitrary output (backups, JSON or source maps).
export function pwaPlugin(): Plugin {
  let outDir: string;
  return {
    name: 'livro-a-livro-pwa', apply: 'build',
    configResolved(config) {
      if (config.base !== '/') throw new Error('The PWA requires its canonical root origin.');
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const assets = (await readdir(resolve(outDir, 'assets')))
        .filter((name) => /\.(js|css|woff2?|png|svg|webp)$/.test(name)).map((name) => `/assets/${name}`);
      const urls = ['/index.html', '/privacidade.html', '/manifest.webmanifest', '/favicon.ico',
        '/icons/book.svg', '/icons/book-maskable.svg', '/icons/book-192.png', '/icons/book-512.png',
        '/icons/book-maskable-512.png', '/icons/apple-touch-icon.png', ...assets].sort();
      const entries = await Promise.all(urls.map(async (url) => ({ url,
        integrity: `sha256-${createHash('sha256').update(await readFile(resolve(outDir, url.slice(1)))).digest('base64')}`,
      })));
      const source = await readFile(new URL('../src/pwa/service-worker.js', import.meta.url), 'utf8');
      const release = createHash('sha256').update(JSON.stringify(entries)).update(source).digest('hex').slice(0, 20);
      await writeFile(resolve(outDir, 'sw.js'), source.replace('__PRECACHE__', JSON.stringify(entries)).replace('__RELEASE__', release));
    },
  };
}
