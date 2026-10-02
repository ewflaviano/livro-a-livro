import { z } from 'zod';
import { openDatabase } from '../adapters/indexeddb/database';
import { parseDomain } from '../domain/errors';
import { isUsageSuspended } from '../analytics/suspension';

const STATE_KEY = 'preferences';
const stateSchema = z.strictObject({
  seed: z.string().regex(/^[a-f0-9]{64}$/),
  consentVersion: z.number().int().min(0).max(1).default(0),
  experimentsConsent: z.boolean(),
  telemetryConsent: z.boolean(),
  highestCatalogRevision: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER).default(-1),
  assignments: z.record(z.string().max(80), z.strictObject({ assignmentVersion: z.number().int().positive(), variant: z.string().max(80) })),
});
export type ExperimentState = z.infer<typeof stateSchema>;

function randomSeed() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function newExperimentState(): ExperimentState {
  return { seed: randomSeed(), consentVersion: 1, experimentsConsent: false, telemetryConsent: false, highestCatalogRevision: -1, assignments: {} };
}
export function normalizeExperimentState(value: unknown): ExperimentState {
  const state = parseDomain(stateSchema, value, 'InvalidLibrary');
  return state.consentVersion === 1 ? state : { ...state, consentVersion: 1, experimentsConsent: false, telemetryConsent: false, assignments: {} };
}

export async function openExperimentStore(options: { name?: string } = {}) {
  const connection = await openDatabase(options);
  async function read(): Promise<ExperimentState> {
    connection.ensureOpen();
    const current = await connection.db.get('experimentState', STATE_KEY);
    if (current === undefined) {
      const created = newExperimentState();
      await connection.db.put('experimentState', created, STATE_KEY);
      return created;
    }
    const state = normalizeExperimentState(current);
    if (state.consentVersion !== (current as { consentVersion?: number }).consentVersion) await connection.db.put('experimentState', state, STATE_KEY);
    const usage = await connection.db.get('experimentState', 'usage-consent-v2');
    return usage === 'accepted' && !isUsageSuspended() ? state : { ...state, experimentsConsent: false, telemetryConsent: false };
  }
  async function patch(patch: Partial<Pick<ExperimentState, 'experimentsConsent' | 'telemetryConsent'>>) {
    connection.ensureOpen();
    const tx = connection.db.transaction('experimentState', 'readwrite');
    const current = await tx.store.get(STATE_KEY);
    const next = { ...(current === undefined ? newExperimentState() : normalizeExperimentState(current)), ...patch };
    await tx.store.put(next, STATE_KEY);
    await tx.done;
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('livro-experiments-changed'));
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('livro-experiments');
      channel.postMessage('changed'); channel.close();
    }
    return next;
  }
  async function saveAssignment(key: string, assignmentVersion: number, variant: string) {
    connection.ensureOpen();
    const tx = connection.db.transaction('experimentState', 'readwrite');
    const current = await tx.store.get(STATE_KEY);
    const state = current === undefined ? newExperimentState() : normalizeExperimentState(current);
    if (!state.experimentsConsent || isUsageSuspended()) { await tx.done; return state; }
    const next = { ...state, assignments: { ...state.assignments, [key]: { assignmentVersion, variant } } };
    await tx.store.put(next, STATE_KEY);
    await tx.done;
    return next;
  }
  async function acceptCatalogRevision(revision: number) {
    connection.ensureOpen();
    const tx = connection.db.transaction('experimentState', 'readwrite');
    const current = await tx.store.get(STATE_KEY);
    const state = current === undefined ? newExperimentState() : normalizeExperimentState(current);
    if (!state.experimentsConsent || isUsageSuspended() || !Number.isSafeInteger(revision) || revision < state.highestCatalogRevision) {
      await tx.done;
      return false;
    }
    if (revision > state.highestCatalogRevision) await tx.store.put({ ...state, highestCatalogRevision: revision }, STATE_KEY);
    await tx.done;
    return true;
  }
  return { read, patch, saveAssignment, acceptCatalogRevision, close: connection.close };
}

export type ExperimentStore = Awaited<ReturnType<typeof openExperimentStore>>;
export function isExperimentState(value: unknown): value is ExperimentState {
  return stateSchema.safeParse(value).success;
}
