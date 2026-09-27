import { z } from 'zod';
import { openDatabase } from '../adapters/indexeddb/database';
import { parseDomain } from '../domain/errors';

const STATE_KEY = 'preferences';
const stateSchema = z.strictObject({
  seed: z.string().regex(/^[a-f0-9]{64}$/),
  experimentsConsent: z.boolean(),
  telemetryConsent: z.boolean(),
  assignments: z.record(z.string().max(80), z.strictObject({ assignmentVersion: z.number().int().positive(), variant: z.string().max(80) })),
});
export type ExperimentState = z.infer<typeof stateSchema>;

function randomSeed() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function defaultState(): ExperimentState {
  return { seed: randomSeed(), experimentsConsent: false, telemetryConsent: false, assignments: {} };
}

export async function openExperimentStore(options: { name?: string } = {}) {
  const connection = await openDatabase(options);
  async function read(): Promise<ExperimentState> {
    connection.ensureOpen();
    const current = await connection.db.get('experimentState', STATE_KEY);
    if (current === undefined) {
      const created = defaultState();
      await connection.db.put('experimentState', created, STATE_KEY);
      return created;
    }
    return parseDomain(stateSchema, current, 'InvalidLibrary');
  }
  async function patch(patch: Partial<Pick<ExperimentState, 'experimentsConsent' | 'telemetryConsent'>>) {
    connection.ensureOpen();
    const tx = connection.db.transaction('experimentState', 'readwrite');
    const current = await tx.store.get(STATE_KEY);
    const next = { ...(current === undefined ? defaultState() : parseDomain(stateSchema, current, 'InvalidLibrary')), ...patch };
    await tx.store.put(next, STATE_KEY);
    await tx.done;
    return next;
  }
  async function saveAssignment(key: string, assignmentVersion: number, variant: string) {
    const current = await read();
    const next = { ...current, assignments: { ...current.assignments, [key]: { assignmentVersion, variant } } };
    await connection.db.put('experimentState', next, STATE_KEY);
    return next;
  }
  return { read, patch, saveAssignment, close: connection.close };
}

export type ExperimentStore = Awaited<ReturnType<typeof openExperimentStore>>;
export function isExperimentState(value: unknown): value is ExperimentState {
  return stateSchema.safeParse(value).success;
}
