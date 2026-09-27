import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.LIVRO_LOCAL_API_PORT || 8788);
const appPort = Number(process.env.LIVRO_LOCAL_APP_PORT || 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Porta local inválida');
if (!Number.isInteger(appPort) || appPort < 1024 || appPort > 65535) throw new Error('Porta do aplicativo inválida');
const env = { ...process.env, LIVRO_LOCAL_API_PORT: String(port), LIVRO_LOCAL_APP_PORT: String(appPort), VITE_LOCAL_MODE: 'true', VITE_LOCAL_API_URL: `http://127.0.0.1:${port}`, VITE_DRIVE_ENABLED: 'false' };
const api = spawn(process.execPath, ['scripts/local-api.mjs'], { cwd: root, env, stdio: 'inherit' });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'], { cwd: root, env, stdio: 'inherit' });
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; api.kill('SIGTERM'); vite.kill('SIGTERM'); process.exitCode = code; }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
for (const child of [api, vite]) { child.once('exit', code => { if (!stopping) stop(code ?? 1); }); child.once('error', () => stop(1)); }
