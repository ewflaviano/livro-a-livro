import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackupWorkerParser } from './worker-parser';
import { parseBackupText } from './serialize';
import fixture from '../../test/fixtures/backups/v1.json';

class SyntheticWorker {
  static instances: SyntheticWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { SyntheticWorker.instances.push(this); }
  respond(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}
afterEach(() => { vi.unstubAllGlobals(); SyntheticWorker.instances = []; });
describe('disposable backup parser worker', () => {
  it('returns parsed data and terminates the completed worker', async () => {
    vi.stubGlobal('Worker', SyntheticWorker); const parser = createBackupWorkerParser();
    const pending = parser.parse(JSON.stringify(fixture)); const worker = SyntheticWorker.instances[0];
    const data = parseBackupText(JSON.stringify(fixture)); worker.respond({ ok: true, data });
    expect(await pending).toEqual(data); expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull(); parser.cancel(); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('rejects the cancelled selection and terminates it before starting a replacement', async () => {
    vi.stubGlobal('Worker', SyntheticWorker); const parser = createBackupWorkerParser();
    const first = parser.parse('first'); const rejection = expect(first).rejects.toMatchObject({ code: 'InvalidBackup' });
    const second = parser.parse('second'); await rejection;
    expect(SyntheticWorker.instances[0].terminate).toHaveBeenCalledOnce();
    const secondRejection = expect(second).rejects.toMatchObject({ code: 'InvalidBackup' });
    parser.cancel(); await secondRejection;
    expect(SyntheticWorker.instances[1].terminate).toHaveBeenCalledOnce();
  });
  it.each(['UnsupportedVersion', 'ImportTooLarge', 'PRIVATE synthetic detail'])('normalizes worker failure %s to a public code', async code => {
    vi.stubGlobal('Worker', SyntheticWorker); const pending = createBackupWorkerParser().parse('{}');
    SyntheticWorker.instances[0].respond({ ok: false, code });
    await expect(pending).rejects.toMatchObject({ code: code === 'PRIVATE synthetic detail' ? 'InvalidBackup' : code });
    expect(SyntheticWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it('handles a worker failure without exposing its diagnostic message', async () => {
    vi.stubGlobal('Worker', SyntheticWorker); const pending = createBackupWorkerParser().parse('{}');
    SyntheticWorker.instances[0].onerror?.({ preventDefault() {}, message: 'PRIVATE synthetic detail' } as ErrorEvent);
    await expect(pending).rejects.toMatchObject({ code: 'InvalidBackup', message: 'InvalidBackup' });
  });
});
