import { afterEach, expect, it, vi } from 'vitest';
import { assertAuthorizationNavigationSafe } from './authorization-navigation';
const state = vi.hoisted(() => ({ blocked: false, update: 'none' }));
vi.mock('../pwa/register', () => ({ getPwaState: () => state }));
afterEach(() => { state.blocked = false; state.update = 'none'; });
it.each(['draft', 'update'])('rejects a late OAuth navigation after a new %s guard, rather than reporting success', async kind => {
  const navigate = vi.fn();
  let finish = () => {};
  const response = new Promise<void>(resolve => { finish = resolve; });
  const request = response.then(() => { assertAuthorizationNavigationSafe(); navigate(); });
  if (kind === 'draft') state.blocked = true; else state.update = 'applying';
  finish();
  await expect(request).rejects.toMatchObject({ code: 'cancelled' });
  expect(navigate).not.toHaveBeenCalled();
});
it('permits navigation only after guards have cleared', () => {
  expect(() => assertAuthorizationNavigationSafe()).not.toThrow();
});
