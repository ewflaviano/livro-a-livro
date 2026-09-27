import { DomainError } from '../domain/errors';
import { parseBackupText } from './serialize';

// This module is a dedicated worker entry, never imported into the UI bundle.
const scope = globalThis as unknown as Pick<Worker, 'onmessage' | 'postMessage'>;
scope.onmessage = (event: MessageEvent<unknown>) => {
  try {
    if (typeof event.data !== 'string') throw new DomainError('InvalidBackup');
    scope.postMessage({ ok: true, data: parseBackupText(event.data) });
  } catch (error) {
    const code = error instanceof DomainError && ['InvalidBackup', 'UnsupportedVersion', 'ImportTooLarge'].includes(error.code)
      ? error.code : 'InvalidBackup';
    scope.postMessage({ ok: false, code });
  }
};
