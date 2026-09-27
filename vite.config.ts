import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pwaPlugin } from './build/pwa-plugin.ts';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
let build = 'local';
try { build = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* Source archives have no Git metadata. */ }

export default defineConfig({ define: { __APP_VERSION__: JSON.stringify(version), __BUILD_ID__: JSON.stringify(build) }, plugins: [react(), pwaPlugin()] });
