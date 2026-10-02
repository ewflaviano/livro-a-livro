import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pwaPlugin } from './build/pwa-plugin.ts';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
let build = 'local';
if (/^[0-9a-f]{40}$/u.test(process.env.GITHUB_SHA ?? '')) build = process.env.GITHUB_SHA!.slice(0, 7);
else try { build = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().slice(0, 7); } catch { /* Source archives have no Git metadata. */ }

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version), __BUILD_ID__: JSON.stringify(build) },
  build: { rollupOptions: { input: { app: 'index.html', about: 'sobre.html', aboutEn: 'about.html', privacy: 'privacidade.html', privacyEn: 'privacy.html' } } },
  plugins: [react(), pwaPlugin()],
});
