import { unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../.local/livro-a-livro');
for (const name of ['drive-state.json', 'drive-state.json.tmp']) {
  try { await unlink(resolve(directory, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
console.log('Cópias descartáveis do simulador removidas. Pare make local antes de executar este comando. Para reiniciar a estante do navegador, remova apenas o banco IndexedDB livro-a-livro-local nas ferramentas do navegador. Dados reais não foram alterados.');
