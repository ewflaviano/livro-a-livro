// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { document.head.querySelectorAll('script[src*="googletagmanager"]').forEach(node => node.remove()); document.cookie = '_ga=; Max-Age=0; Path=/'; delete (window as unknown as { dataLayer?: unknown }).dataLayer; delete (window as unknown as { gtag?: unknown }).gtag; delete (window as unknown as Record<string, unknown>)['ga-disable-G-MV35ES1S2S']; vi.resetModules(); });
it('never loads before acceptance, configures privacy controls and sends sanitized allowlisted routes', async () => {
  const ga = await import('./ga4');
  expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
  const enabled = ga.enableAnalytics(); const script = document.querySelector('script[src*="googletagmanager"]')!;
  expect(script.getAttribute('src')).toBe('https://www.googletagmanager.com/gtag/js?id=G-MV35ES1S2S');
  script.dispatchEvent(new Event('load')); expect(await enabled).toBe(true);
  ga.recordPublicPage('/livro/ABCDEF00-0000-4000-8000-000000000001'); ga.recordPublicPage('/desconhecida');
  const layer = (window as unknown as { dataLayer: unknown[][] }).dataLayer;
  expect(Object.prototype.toString.call(layer.find(row => row[0] === 'config'))).toBe('[object Arguments]');
  expect(Array.from(layer.find(row => row[0] === 'set')!)).toEqual(['set', { page_title: 'Estante', page_location: `${location.origin}/estante`, page_path: '/estante', page_referrer: '' }]);
  expect(Array.from(layer.find(row => row[0] === 'config')!)).toEqual(['config', 'G-MV35ES1S2S', expect.objectContaining({ send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, cookie_expires: 2592000 })]);
  expect(layer.filter(row => row[0] === 'event').map(row => Array.from(row))).toEqual([['event', 'page_view', { page_title: 'Livro', page_location: `${location.origin}/livro`, page_path: '/livro', page_referrer: '' }]]);
  expect(JSON.stringify(layer)).not.toContain('ABCDEF00'); expect(ga.publicPage('/livro/ABCDEF00?secret=1')).toBeNull();
});
it('revocation disables commands and clears accessible GA cookies', async () => {
  const ga = await import('./ga4'); const enabled = ga.enableAnalytics(); document.querySelector('script[src*="googletagmanager"]')!.dispatchEvent(new Event('load')); await enabled;
  document.cookie = '_ga=test; Path=/'; document.cookie = '_ga_ABC=test; Path=/'; document.cookie = 'other=keep; Path=/';
  ga.disableAnalytics(); ga.recordPublicPage('/dados');
  expect((window as unknown as Record<string, boolean>)['ga-disable-G-MV35ES1S2S']).toBe(true);
  expect(document.cookie).not.toContain('_ga='); expect(document.cookie).not.toContain('_ga_ABC='); expect(document.cookie).toContain('other=keep');
});
it('late script load after revocation never records an event', async () => {
  const ga = await import('./ga4'); const enabled = ga.enableAnalytics(); const script = document.querySelector('script[src*="googletagmanager"]')!;
  ga.disableAnalytics(); script.dispatchEvent(new Event('load')); expect(await enabled).toBe(false);
  ga.recordPublicPage('/estante'); expect((window as unknown as { dataLayer: unknown[][] }).dataLayer.filter(row => row[0] === 'event')).toEqual([]);
});

it('sanitizes global configuration before any automatic tag event can fire', async () => {
  const ga = await import('./ga4');
  const pending = ga.enableAnalytics('/livro/abcdef00-0000-4000-8000-000000000001');
  const layer = (window as unknown as { dataLayer: unknown[][] }).dataLayer;
  const config = layer.find(row => row[0] === 'config')!;
  expect(config[2]).toMatchObject({ page_location: `${location.origin}/livro`, page_path: '/livro', page_referrer: '', send_page_view: false });
  expect(JSON.stringify(layer)).not.toContain('abcdef00-0000');
  document.querySelector('script[src*="googletagmanager"]')!.dispatchEvent(new Event('load')); await pending;
});
it('keeps accepted cookies during a temporary script load failure while disabling measurement', async () => {
  document.cookie = '_ga=synthetic; Path=/';
  const ga = await import('./ga4'); const loading = ga.enableAnalytics('/dados');
  document.querySelector('script[src*="googletagmanager"]')!.dispatchEvent(new Event('error'));
  expect(await loading).toBe(false); expect(document.cookie).toContain('_ga=synthetic');
  expect((window as unknown as Record<string, boolean>)['ga-disable-G-MV35ES1S2S']).toBe(true);
});
