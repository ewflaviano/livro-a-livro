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
  const { service, registration, waiting, container, reload } = await setup();
  waiting.postMessage.mockImplementationOnce((_message, ports) => ports[0].send({ applied: true }));
  await service.applyPwaUpdate(); expect(service.getPwaState().update).toBe('applying');
  const release = service.blockPwaUpdate(); registration.waiting = null as never;
  container.dispatchEvent(new Event('controllerchange'));
  expect(reload).not.toHaveBeenCalled();
  waiting.state = 'activated'; waiting.dispatchEvent(new Event('statechange'));
  expect(service.getPwaState()).toMatchObject({ blocked: true, update: 'reload-ready' }); release();
  expect(reload).not.toHaveBeenCalled();
  await service.applyPwaUpdate(); expect(reload).toHaveBeenCalledOnce();
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
  expect(service.getPwaState()).toMatchObject({ blocked: true, update: 'reload-ready' }); release();
  expect(reload).not.toHaveBeenCalled();
  await service.applyPwaUpdate(); expect(reload).toHaveBeenCalledOnce();
});

it('automatically applies exactly once after startup and never on a later check', async () => {
  const { service, waiting, container, reload } = await setup();
  waiting.postMessage.mockImplementationOnce((_message, ports) => ports[0].send({ applied: true }));
  expect(waiting.postMessage).not.toHaveBeenCalled();
  service.armPwaStartup(() => true);
  await vi.waitFor(() => expect(service.getPwaState().update).toBe('applying'));
  waiting.state = 'activated'; waiting.dispatchEvent(new Event('statechange'));
  container.dispatchEvent(new Event('controllerchange'));
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  await service.checkPwaUpdate(); service.armPwaStartup(() => true);
  expect(reload).toHaveBeenCalledOnce();
});
it.each(['interaction', 'hidden', 'occupied', 'draft'])('does not automatically apply after %s and never rearms', async reason => {
  const { service, waiting } = await setup();
  let idle = reason !== 'occupied';
  const release = reason === 'draft' ? service.blockPwaUpdate() : () => {};
  if (reason === 'interaction') document.dispatchEvent(new Event('pointerdown'));
  if (reason === 'hidden') vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  service.armPwaStartup(() => idle);
  if (reason === 'occupied' || reason === 'draft') document.dispatchEvent(new Event('pointerdown'));
  release(); idle = true; vi.restoreAllMocks();
  await service.checkPwaUpdate(); window.dispatchEvent(new Event('focus')); service.armPwaStartup(() => true);
  expect(waiting.postMessage).not.toHaveBeenCalled();
});
it('keeps first installation manual-free even after startup settles', async () => {
  const { service, waiting, registration, reload } = await setup(true);
  service.armPwaStartup(() => true);
  registration.waiting = null as never; registration.active = waiting; waiting.state = 'activated'; waiting.dispatchEvent(new Event('statechange'));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(waiting.postMessage.mock.calls.some(([message]) => message.type === 'APPLY_UPDATE')).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});
it('waits for an initial installing replacement, then applies after its installation', async () => {
  const { service, waiting, registration } = await setup();
  // Capture the initial worker, whose install can settle after composition arms.
  waiting.state = 'installing'; registration.installing = waiting; registration.waiting = null as never;
  service.armPwaStartup(() => true); expect(waiting.postMessage).not.toHaveBeenCalled();
  waiting.postMessage.mockImplementationOnce((_message, ports) => ports[0].send({ applied: true }));
  registration.dispatchEvent(new Event('updatefound'));
  waiting.state = 'installed'; registration.waiting = waiting; registration.installing = null;
  waiting.dispatchEvent(new Event('statechange'));
  await vi.waitFor(() => expect(service.getPwaState().update).toBe('applying'));
});
it('holds operations separately from draft state and refuses new work while applying', async () => {
  const { service, waiting } = await setup();
  const release = service.holdPwaReload()!;
  expect(service.getPwaState()).toMatchObject({ blocked: false, operationPending: true });
  service.armPwaStartup(() => true); expect(waiting.postMessage).not.toHaveBeenCalled();
  waiting.postMessage.mockImplementationOnce((_message, ports) => ports[0].send({ applied: true }));
  release(); await vi.waitFor(() => expect(service.getPwaState().update).toBe('applying'));
  expect(service.holdPwaReload()).toBeNull();
});
it('late interaction leaves an activated update ready for an explicit reopen', async () => {
  const { service, waiting, reload } = await setup();
  waiting.postMessage.mockImplementationOnce((_message, ports) => ports[0].send({ applied: true }));
  service.armPwaStartup(() => true); await vi.waitFor(() => expect(service.getPwaState().update).toBe('applying'));
  document.dispatchEvent(new Event('keydown')); waiting.state = 'activated'; waiting.dispatchEvent(new Event('statechange'));
  await vi.waitFor(() => expect(service.getPwaState().update).toBe('reload-ready')); expect(reload).not.toHaveBeenCalled();
  await service.applyPwaUpdate(); expect(reload).toHaveBeenCalledOnce();
});
it('an ACK timeout followed by activation never triggers a late reload', async () => {
  const { service, waiting, registration, reload } = await setup();
  vi.useFakeTimers();
  try {
    waiting.postMessage.mockImplementationOnce(() => {});
    const applying = service.applyPwaUpdate(); await vi.advanceTimersByTimeAsync(5001); await applying;
    expect(service.getPwaState().update).toBe('failed');
    registration.waiting = null as never; waiting.state = 'activated'; waiting.dispatchEvent(new Event('statechange'));
    expect(service.getPwaState().update).toBe('reload-ready'); expect(reload).not.toHaveBeenCalled();
    await service.applyPwaUpdate(); expect(reload).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

it.each(['redundant', 'timeout'])('releases the applying gate when activation ends with %s', async reason => {
  const { service, waiting, reload } = await setup(); vi.useFakeTimers();
  try {
    waiting.postMessage.mockImplementationOnce((_message, ports) => ports[0].send({ applied: true }));
    await service.applyPwaUpdate();
    if (reason === 'redundant') { waiting.state = 'redundant'; waiting.dispatchEvent(new Event('statechange')); }
    else await vi.advanceTimersByTimeAsync(10_001);
    expect(service.getPwaState().update).toBe('failed');
    const release = service.holdPwaReload(); expect(release).toBeTypeOf('function'); release?.();
    if (reason === 'timeout') {
      waiting.state = 'activated'; waiting.dispatchEvent(new Event('statechange'));
      expect(service.getPwaState().update).toBe('reload-ready');
    }
    expect(reload).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it('an activation before the ACK waits for the worker response before reloading', async () => {
  const { service, waiting, reload } = await setup();
  let acknowledge!: () => void;
  waiting.postMessage.mockImplementationOnce((_message, ports) => { acknowledge = () => ports[0].send({ applied: true }); });
  const applying = service.applyPwaUpdate();
  waiting.state = 'activated'; waiting.dispatchEvent(new Event('statechange'));
  expect(reload).not.toHaveBeenCalled(); acknowledge(); await applying;
  expect(reload).toHaveBeenCalledOnce();
});

it('defers the initial opportunity across a temporary draft or dialog until a clean release', async () => {
  const { service, waiting } = await setup();
  let idle = false; const release = service.blockPwaUpdate();
  service.armPwaStartup(() => idle); expect(waiting.postMessage).not.toHaveBeenCalled();
  release(); expect(waiting.postMessage).not.toHaveBeenCalled();
  idle = true; service.reevaluatePwaStartup();
  await vi.waitFor(() => expect(service.getPwaState().update).toBe('applying'));
});
