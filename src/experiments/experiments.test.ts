import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import { assignExperiment } from './assignment';
import { fetchCatalog, parseCatalog } from './catalog';
import { isExperimentKey } from './registry';
import { openExperimentStore } from './store';
import { createTelemetry } from '../diagnostics/telemetry';

const validCatalog = {
  catalogRevision: 4,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  experiments: [{ key: 'shelf-summary-layout', assignmentVersion: 1, enabled: true, killSwitch: false, rolloutBasisPoints: 10_000,
    variants: [{ key: 'control', weight: 5_000 }, { key: 'compact', weight: 5_000 }],
    eligibility: { minBuild: null, maxBuild: null, startsAt: null, endsAt: null, requiresDrive: false } }],
};

describe('local experiment gates', () => {
  const names: string[] = [];
  afterEach(async () => { await Promise.all(names.splice(0).map((name) => deleteDB(name))); });
  it('keeps consent, seed and assignments only in IndexedDB', async () => {
    const name = `experiments-${crypto.randomUUID()}`; names.push(name);
    const store = await openExperimentStore({ name });
    const initial = await store.read();
    expect(initial.experimentsConsent).toBe(false);
    expect(initial.telemetryConsent).toBe(false);
    expect(initial.seed).toMatch(/^[a-f0-9]{64}$/);
    const updated = await store.patch({ experimentsConsent: true });
    expect(await store.acceptCatalogRevision(4)).toBe(true);
    await store.saveAssignment('shelf-summary-layout', 1, 'compact');
    store.close();
    const reopened = await openExperimentStore({ name });
    expect((await reopened.read()).seed).toBe(initial.seed);
    expect((await reopened.read()).experimentsConsent).toBe(true);
    expect((await reopened.read()).highestCatalogRevision).toBe(4);
    expect(await reopened.acceptCatalogRevision(3)).toBe(false);
    expect(await reopened.acceptCatalogRevision(4)).toBe(true);
    expect(updated.telemetryConsent).toBe(false);
    reopened.close();
  });

  it('fails to control for invalid, expired, unknown and kill-switched catalog entries', async () => {
    expect(parseCatalog({ ...validCatalog, expiresAt: '2000-01-01T00:00:00.000Z' })).toBeNull();
    expect(parseCatalog({ ...validCatalog, experiments: [{ ...validCatalog.experiments[0], key: 'unknown' }] })?.experiments).toEqual([]);
    const experiment = parseCatalog(validCatalog)!.experiments[0]!;
    const state = { seed: 'a'.repeat(64), experimentsConsent: false, telemetryConsent: false, highestCatalogRevision: -1, assignments: {} };
    expect(await assignExperiment(experiment, state, { build: '1', driveConnected: false })).toBeNull();
    expect(await assignExperiment({ ...experiment, killSwitch: true }, { ...state, experimentsConsent: true }, { build: '1', driveConnected: false })).toBeNull();
  });

  it('removes a saved participant when rollout shrinks and honours the kill switch', async () => {
    const experiment = parseCatalog(validCatalog)!.experiments[0]!;
    const state = { seed: 'b'.repeat(64), experimentsConsent: true, telemetryConsent: false, highestCatalogRevision: -1,
      assignments: { 'shelf-summary-layout': { assignmentVersion: 1, variant: 'compact' } } };
    expect(await assignExperiment({ ...experiment, rolloutBasisPoints: 0 }, state, { build: '0.1.0', driveConnected: false })).toBeNull();
    expect(await assignExperiment({ ...experiment, killSwitch: true }, state, { build: '0.1.0', driveConnected: false })).toBeNull();
    expect(await assignExperiment(experiment, state, { build: '0.1.0', driveConnected: false })).toMatchObject({ variant: 'compact' });
  });

  it('rejects excessive lifetime, repeated keys and prototype property names', () => {
    expect(parseCatalog({ ...validCatalog, expiresAt: new Date(Date.now() + 6 * 60_000).toISOString() })).toBeNull();
    expect(parseCatalog({ ...validCatalog, experiments: [validCatalog.experiments[0], validCatalog.experiments[0]] })).toBeNull();
    expect(isExperimentKey('toString')).toBe(false);
  });

  it('compares build versions numerically', async () => {
    const experiment = parseCatalog(validCatalog)!.experiments[0]!;
    const state = { seed: 'b'.repeat(64), experimentsConsent: true, telemetryConsent: false, highestCatalogRevision: -1, assignments: {} };
    const entry = { ...experiment, eligibility: { ...experiment.eligibility, minBuild: '0.9.0' } };
    expect(await assignExperiment(entry, state, { build: '0.10.0', driveConnected: false })).not.toBeNull();
    expect(await assignExperiment(entry, state, { build: '0.8.9', driveConnected: false })).toBeNull();
  });

  it('rejects oversized and redirected catalog responses', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const fetcher = vi.fn().mockResolvedValue(new Response(' '.repeat(65 * 1024)));
    expect(await fetchCatalog(fetcher, 'https://api.example.test')).toBeNull();
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
    vi.unstubAllGlobals();
  });

  it('assigns deterministically and preserves a matching saved assignment', async () => {
    const experiment = parseCatalog(validCatalog)!.experiments[0]!;
    const state = { seed: 'b'.repeat(64), experimentsConsent: true, telemetryConsent: false, highestCatalogRevision: -1,
      assignments: { 'shelf-summary-layout': { assignmentVersion: 1, variant: 'compact' } } };
    await expect(assignExperiment(experiment, state, { build: '1', driveConnected: false })).resolves.toEqual({ key: 'shelf-summary-layout', variant: 'compact', assignmentVersion: 1 });
  });
});

describe('opt-in telemetry', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('does nothing without consent and sends only aggregated allowlisted dimensions after consent', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const telemetry = createTelemetry('https://api.example.test', fetcher);
    telemetry.record({ build: '1', experiment: 'shelf-summary-layout', revision: 1, variant: 'compact', event: 'use' });
    expect(telemetry.snapshot()).toEqual([]);
    telemetry.setEnabled(true);
    telemetry.record({ build: '1', experiment: 'shelf-summary-layout', revision: 1, variant: 'compact', event: 'use' });
    telemetry.record({ build: '1', experiment: 'shelf-summary-layout', revision: 1, variant: 'compact', event: 'use' });
    expect(await telemetry.flush()).toBe(true);
    expect(fetcher).toHaveBeenCalledWith('https://api.example.test/v1/telemetry/batches', expect.objectContaining({ credentials: 'omit' }));
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).items[0]).toMatchObject({ count: 2, event: 'use' });
  });
});
