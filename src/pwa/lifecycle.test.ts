// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(remove => remove()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function worker(state: string, applied = false) {
  return Object.assign(new EventTarget(), { state, postMessage: vi.fn((message, ports) => ports[0].send(message.type === 'OFFLINE_STATUS' ? { ready: true } : { applied })) });
}
async function setup(first = false) {
  vi.resetModules();
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
      add(type, listener, options); cleanup.push(() => target.removeEventListener(type, listener, options));
    });
  }
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('MessageChannel', class {
    port1 = { onmessage: (_event: { data: unknown }) => {}, close() {} };
    port2 = { send: (data: unknown) => queueMicrotask(() => this.port1.onmessage({ data })) };
  });
  const active = worker('activated'); const waiting = worker('installed');
  const registration = Object.assign(new EventTarget(), { active: first ? null : active, installing: first ? waiting : null, waiting, update: vi.fn(async () => {}) });
  const container = Object.assign(new EventTarget(), { controller: first ? null : active, register: vi.fn(async () => registration), ready: Promise.resolve(registration) });
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: container });
  const reload = vi.fn();
  const service = await import('./register'); await service.registerPwa(reload);
  return { service, registration, waiting, active, container, reload };
}
it('never announces first installation as update even while waiting temporarily exists', async () => {
  const { service, registration, waiting } = await setup(true);
  expect(service.getPwaState().update).toBe('none');
  registration.waiting = null as never; registration.active = waiting; waiting.state = 'activated';
  waiting.dispatchEvent(new Event('statechange'));
  await vi.waitFor(() => expect(service.getPwaState().availability).toBe('ready'));
  expect(service.getPwaState().update).toBe('none');
});
it('reconciles a real waiting replacement at focus and explicit checks, including stale banners', async () => {
  const { service, registration, waiting } = await setup();
  expect(service.getPwaState().update).toBe('available');
  registration.waiting = null as never;
  window.dispatchEvent(new Event('focus'));
  expect(service.getPwaState().update).toBe('none');
  registration.waiting = waiting;
  await service.checkPwaUpdate();
  expect(service.getPwaState().update).toBe('available');
  await service.checkPwaUpdate();
  expect(registration.update.mock.calls.length).toBeGreaterThanOrEqual(2);
});
it('keeps draft guards and the worker multi-window refusal before activating', async () => {
  const { service, registration, waiting, container } = await setup();
  const release = service.blockPwaUpdate();
  await service.applyPwaUpdate(); expect(waiting.postMessage).not.toHaveBeenCalled();
  release(); await service.applyPwaUpdate();
  expect(service.getPwaState().update).toBe('other-tabs');
  const newDraft = service.blockPwaUpdate();
  registration.waiting = null as never;
  container.dispatchEvent(new Event('controllerchange'));
  expect(service.getPwaState()).toMatchObject({ blocked: true, update: 'none' }); newDraft();
});
it('keeps a failed check honest without erasing local availability', async () => {
  const { service, registration } = await setup();
  registration.update.mockRejectedValueOnce(new Error());
  expect(await service.checkPwaUpdate()).toBe(false);
});

it('does not reload when a draft appears after agreeing to activation', async () => {
  const { service, registration, waiting, container } = await setup();
  waiting.postMessage.mockImplementationOnce((_message, ports) => ports[0].send({ applied: true }));
  await service.applyPwaUpdate(); expect(service.getPwaState().update).toBe('applying');
  const release = service.blockPwaUpdate(); registration.waiting = null as never;
  container.dispatchEvent(new Event('controllerchange'));
  expect(service.getPwaState()).toMatchObject({ blocked: true, update: 'none' }); release();
});

it('completes an approved replacement without a controller and reloads only once', async () => {
  const { service, registration, waiting, container, reload } = await setup();
  container.controller = null as never;
  waiting.postMessage.mockImplementationOnce((_message, ports) => ports[0].send({ applied: true }));
  await service.applyPwaUpdate();
  registration.waiting = null as never; registration.active = waiting; waiting.state = 'activated';
  waiting.dispatchEvent(new Event('statechange'));
  container.dispatchEvent(new Event('controllerchange'));
  expect(reload).toHaveBeenCalledOnce();
});

it('preserves a new draft on the activated path without a controller', async () => {
  const { service, registration, waiting, container, reload } = await setup();
  container.controller = null as never;
  waiting.postMessage.mockImplementationOnce((_message, ports) => ports[0].send({ applied: true }));
  await service.applyPwaUpdate(); const release = service.blockPwaUpdate();
  registration.waiting = null as never; registration.active = waiting; waiting.state = 'activated';
  waiting.dispatchEvent(new Event('statechange'));
  expect(reload).not.toHaveBeenCalled();
  expect(service.getPwaState()).toMatchObject({ blocked: true, update: 'none' }); release();
});
