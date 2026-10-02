// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExperimentProvider, useExperiment } from './ExperimentProvider';
import { openExperimentStore } from './store';
import { openAnalyticsConsentStore } from '../analytics/consent';

const catalog = () => ({
  catalogRevision: 1,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  experiments: [{ key: 'shelf-summary-layout', assignmentVersion: 1, enabled: true, killSwitch: false,
    rolloutBasisPoints: 10_000, variants: [{ key: 'compact', weight: 10_000 }],
    eligibility: { minBuild: null, maxBuild: null, startsAt: null, endsAt: null, requiresDrive: false } }],
});
function Variant() { return <span>{useExperiment('shelf-summary-layout')}</span>; }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('does not request a catalog before consent and drops an active variant when consent is revoked', async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json(catalog()));
  vi.stubGlobal('fetch', fetcher);
  const store = await openExperimentStore();
  try {
    render(<ExperimentProvider baseUrl="https://api.example.test"><Variant /></ExperimentProvider>);
    expect(screen.getByText('control')).toBeTruthy();
    await waitFor(() => expect(fetcher).not.toHaveBeenCalled());
    const consent = await openAnalyticsConsentStore();
    await consent.write('accepted');
    consent.close();
    await waitFor(() => expect(screen.getByText('compact')).toBeTruthy());
    expect(fetcher).toHaveBeenCalledWith('https://api.example.test/v1/experiments/catalog', expect.objectContaining({ credentials: 'omit' }));
    const revocation = await openAnalyticsConsentStore();
    await revocation.write('rejected'); revocation.close();
    await waitFor(() => expect(screen.getByText('control')).toBeTruthy());
  } finally { store.close(); }
});
