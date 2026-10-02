// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { clearUsageSuspension, isUsageSuspended, suspendUsage } from './suspension';

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
