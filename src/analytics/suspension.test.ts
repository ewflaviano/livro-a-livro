// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { clearUsageSuspension, isUsageSuspended, listenUsageSuspension, suspendUsage } from './suspension';

afterEach(() => { vi.unstubAllGlobals(); clearUsageSuspension(); });

it('uses session storage when local storage cannot hold a pending revocation', () => {
  const local = window.localStorage;
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
  suspendUsage();
  expect(isUsageSuspended()).toBe(true);
  expect(window.sessionStorage.getItem('livro-a-livro-usage-suspended-v1')).toBe('1');
  vi.unstubAllGlobals();
  expect(window.localStorage).toBe(local);
  clearUsageSuspension();
  expect(isUsageSuspended()).toBe(false);
});

it('does not resume a failed local revocation when another tab accepts', () => {
  let receive: ((event: MessageEvent) => void) | undefined;
  class Channel {
    postMessage() {}
    close() {}
    addEventListener(_type: string, listener: (event: MessageEvent) => void) { receive = listener; }
    removeEventListener() {}
  }
  vi.stubGlobal('BroadcastChannel', Channel);
  const stop = listenUsageSuspension();
  suspendUsage();
  receive?.({ data: { value: 'resume', from: 'another-tab' } } as MessageEvent);
  expect(isUsageSuspended()).toBe(true);
  expect(window.sessionStorage.getItem('livro-a-livro-usage-suspended-v1')).toBe('1');
  clearUsageSuspension();
  receive?.({ data: { value: 'resume', from: 'another-tab' } } as MessageEvent);
  expect(isUsageSuspended()).toBe(false);
  stop();
});
