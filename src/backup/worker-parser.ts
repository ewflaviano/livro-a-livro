import { DomainError } from '../domain/errors';
import type { LibraryExport } from './schema';

export type BackupParser = { parse(text: string): Promise<LibraryExport>; cancel(): void };
/** A cancelled selection owns no surviving worker, event handler or pending promise. */
export function createBackupWorkerParser(): BackupParser {
  let cancelActive: (() => void) | undefined;
  const cancel = () => { cancelActive?.(); };
  return {
    cancel,
    parse(text) {
      cancel();
      return new Promise((resolve, reject) => {
        let worker: Worker;
        try { worker = new Worker(new URL('./import-worker.ts', import.meta.url), { type: 'module' }); }
        catch { reject(new DomainError('InvalidBackup')); return; }
        const cleanup = () => { worker.onmessage = null; worker.onerror = null; worker.terminate(); cancelActive = undefined; };
        cancelActive = () => { cleanup(); reject(new DomainError('InvalidBackup')); };
        worker.onerror = event => { event.preventDefault(); cleanup(); reject(new DomainError('InvalidBackup')); };
        worker.onmessage = event => {
          cleanup();
          if (event.data?.ok === true) resolve(event.data.data);
          else {
            const code = event.data?.code;
            reject(new DomainError(code === 'UnsupportedVersion' || code === 'ImportTooLarge' ? code : 'InvalidBackup'));
          }
        };
        try { worker.postMessage(text); }
        catch { cleanup(); reject(new DomainError('InvalidBackup')); }
      });
    },
  };
}
