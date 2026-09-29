#!/usr/bin/env node
// Temporary, public static QA build. No OAuth interception, credentials or production edits.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Use --out with a new directory outside the repository.');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('A Git commit is required.');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const output = args.length ? resolve(args[1]) : await mkdtemp(join(tmpdir(), 'lal-drive-qa-'));
if (output === root || output.startsWith(root + sep)) throw new Error('QA output must be outside the repository.');
if (args.length) await mkdir(output); // Refuse to overwrite an existing directory.
const prefix = `/validacao-drive/${commit.slice(0, 12)}/`;
const metadata = { commit, prefix, builtAt: new Date().toISOString(), slots: [] };

function replaceOnce(source, expected, replacement) {
  if (source.split(expected).length !== 2) throw new Error('QA source contract changed; review the build transform.');
  return source.replace(expected, replacement);
}

for (const slot of ['a', 'b']) {
  const base = `${prefix}${slot}/`;
  const database = `livro-a-livro-qa-${commit.slice(0, 12)}-${slot}`;
  const url = `https://livroalivro.app.br${base}index.html#/dados`;
  const seen = new Set();
  await build({
    root, configFile: false, publicDir: false, base, logLevel: 'warn',
    define: {
      __APP_VERSION__: JSON.stringify(version), __BUILD_ID__: JSON.stringify(commit.slice(0, 12)),
      'import.meta.env.VITE_DRIVE_ENABLED': JSON.stringify('true'),
      'import.meta.env.VITE_LOCAL_MODE': JSON.stringify('false'),
    },
    build: { outDir: join(output, slot), emptyOutDir: false, sourcemap: false, rollupOptions: { input: join(root, 'index.html') } },
    plugins: [{
      name: 'temporary-drive-qa', enforce: 'pre',
      transform(source, id) {
        if (id === join(root, 'src/adapters/indexeddb/schema.ts')) {
          seen.add('database');
          return replaceOnce(source,
            "export const DATABASE_NAME = import.meta.env.DEV && import.meta.env.VITE_LOCAL_MODE === 'true' ? 'livro-a-livro-local' : 'livro-a-livro';",
            `export const DATABASE_NAME = ${JSON.stringify(database)};`);
        }
        if (id === join(root, 'src/app/main.tsx')) {
          seen.add('entry');
          source = replaceOnce(source, 'observePwaInteraction();',
            `if (window.location.origin !== 'https://livroalivro.app.br' || window.location.pathname !== ${JSON.stringify(base + 'index.html')}) throw new Error('QA_PATH_REQUIRED');`);
          return source;
        }
        if (id === join(root, 'src/i18n/context.tsx')) {
          seen.add('locale');
          source = replaceOnce(source, 'if (import.meta.env.PROD) void registerPwa();', '');
          return replaceOnce(source, "if (manifest.getAttribute('href') !== path) manifest.href = path;", 'manifest.remove();');
        }
        if (id === join(root, 'src/pwa/install.ts')) {
          seen.add('install');
          source = replaceOnce(source, 'export function startInstallObservation() {', 'export function startInstallObservation() { return;');
          return replaceOnce(source, 'export async function requestInstall() {', 'export async function requestInstall() { return;');
        }
        if (id === join(root, 'src/app/SyncProvider.tsx')) {
          seen.add('transport');
          return `import { createQaFetch } from '/scripts/drive-qa-transport.mjs';\n` + replaceOnce(source,
            "const fetcher = local ? (await import('../sync/local-client')).localTransport() : fetch;",
            `const fetcher = createQaFetch(${JSON.stringify(`livro-a-livro-qa-${commit.slice(0, 12)}`)});`);
        }
      },
      transformIndexHtml(html) {
        html = replaceOnce(html, '<title>Livro a Livro</title>', `<title>Validação ${slot.toUpperCase()} · Livro a Livro</title>`);
        html = replaceOnce(html, '<head>', `<head>\n    <meta name="robots" content="noindex,nofollow,noarchive" />\n    <link rel="stylesheet" href="${base}qa.css" />`);
        return replaceOnce(html, '<body>', `<body>\n    <aside class="qa-banner" aria-label="Ambiente de validação">Validação ${slot.toUpperCase()} · Somente dados sintéticos · Armazenamento separado · Não instalar</aside>`);
      },
      generateBundle() {
        if (seen.size !== 5) throw new Error('QA isolation transforms were not applied.');
        this.emitFile({ type: 'asset', fileName: 'qa.css', source: '.qa-banner{position:sticky;top:0;z-index:10000;padding:.65rem 1rem;background:#fff1b8;color:#382800;border-bottom:2px solid #765a00;font:600 14px/1.4 system-ui,sans-serif;text-align:center} .qa-banner~#root{min-height:calc(100dvh - 3rem)}' });
      },
    }, react()],
  });
  metadata.slots.push({ slot, database, url, directory: join(output, slot) });
}
// Operational metadata stays outside the published a/ and b/ directories.
await writeFile(join(output, 'build-info.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(`QA_BUILD_READY ${output}`);
for (const entry of metadata.slots) console.log(entry.url);
