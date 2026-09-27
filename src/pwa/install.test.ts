// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
const removals: (() => void)[] = [];
afterEach(() => { removals.splice(0).forEach(remove => remove()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup(installed = false) {
  vi.resetModules();
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    add(type, listener, options); removals.push(() => window.removeEventListener(type, listener, options));
  });
  vi.stubGlobal('matchMedia', () => ({ matches: installed, addEventListener() {} }));
  const service = await import('./install'); service.startInstallObservation(); return service;
}
it('has no install button capability without a native event and observes standalone', async () => {
  const service = await setup(true); expect(service.getInstallState()).toMatchObject({ installed: true, available: false });
});
it.each(['accepted', 'dismissed'] as const)('consumes native prompt once and reports %s without inventing installation', async outcome => {
  const service = await setup();
  expect(service.getInstallState().available).toBe(false);
  const prompt = vi.fn(async () => {});
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome }) });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(service.getInstallState().available).toBe(true);
  await service.requestInstall(); await service.requestInstall();
  expect(prompt).toHaveBeenCalledOnce();
  expect(service.getInstallState()).toMatchObject({ installed: false, available: false, busy: false, outcome });
  window.dispatchEvent(new Event('appinstalled'));
  expect(service.getInstallState()).toMatchObject({ installed: true, available: false, outcome: 'none' });
});
it('handles a native prompt failure without claiming success', async () => {
  const service = await setup();
  window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: async () => { throw new Error(); } }));
  await service.requestInstall(); expect(service.getInstallState()).toMatchObject({ outcome: 'failed', busy: false, installed: false });
});
