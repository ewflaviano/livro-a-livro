// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExperimentProvider, useExperiment } from './ExperimentProvider';
import { openExperimentStore } from './store';
import { openAnalyticsConsentStore } from '../analytics/consent';
import { clearUsageSuspension, suspendUsage } from '../analytics/suspension';
const telemetry = vi.hoisted(() => ({ setEnabled: vi.fn(), record: vi.fn() }));
vi.mock('../diagnostics/telemetry', () => ({ experimentTelemetry: telemetry }));

const catalog = (catalogRevision = 1) => ({
  catalogRevision,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  experiments: [{ key: 'shelf-summary-layout', assignmentVersion: 1, enabled: true, killSwitch: false,
    rolloutBasisPoints: 10_000, variants: [{ key: 'compact', weight: 10_000 }],
    eligibility: { minBuild: null, maxBuild: null, startsAt: null, endsAt: null, requiresDrive: false } }],
});
function Variant() { return <span>{useExperiment('shelf-summary-layout')}</span>; }
afterEach(() => { cleanup(); clearUsageSuspension(); telemetry.setEnabled.mockClear(); telemetry.record.mockClear(); vi.unstubAllGlobals(); });

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

it('keeps the control variant after a failed revocation even while durable consent is still accepted', async () => {
  const consent = await openAnalyticsConsentStore();
  await consent.write('accepted'); consent.close();
  const fetcher = vi.fn().mockImplementation(async () => Response.json(catalog()));
  vi.stubGlobal('fetch', fetcher);
  render(<ExperimentProvider baseUrl="https://api.example.test"><Variant /></ExperimentProvider>);
  await waitFor(() => expect(screen.getByText('compact')).toBeTruthy());
  suspendUsage();
  await waitFor(() => expect(screen.getByText('control')).toBeTruthy());
  const calls = fetcher.mock.calls.length;
  window.dispatchEvent(new Event('focus'));
  await waitFor(() => expect(screen.getByText('control')).toBeTruthy());
  expect(fetcher).toHaveBeenCalledTimes(calls);
});

it('records the stable assignment version after a catalog rollout revision advances', async () => {
  const consent = await openAnalyticsConsentStore();
  await consent.write('accepted'); consent.close();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json(catalog(2))));
  render(<ExperimentProvider baseUrl="https://api.example.test"><Variant /></ExperimentProvider>);
  await waitFor(() => expect(screen.getByText('compact')).toBeTruthy());
  await waitFor(() => expect(telemetry.record).toHaveBeenCalledWith(expect.objectContaining({
    experiment: 'shelf-summary-layout', revision: 1, variant: 'compact', event: 'exposure',
  })));
});
