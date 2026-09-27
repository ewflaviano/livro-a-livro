const MEASUREMENT_ID = 'G-MV35ES1S2S';
const SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
const DISABLE = `ga-disable-${MEASUREMENT_ID}`;
const consent = (analytics: 'granted' | 'denied') => ({ analytics_storage: analytics, ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
type Command = [string, ...unknown[]];
type TagWindow = Window & { dataLayer?: IArguments[]; gtag?: (...args: Command) => void; [DISABLE]?: boolean };
const tag = () => window as TagWindow;
let generation = 0, script: HTMLScriptElement | undefined, configured = false;
export const analyticsScriptUrl = SCRIPT_URL;
export function publicPage(pathname: string): { path: string; title: string } | null {
  if (/^\/livro\/[0-9a-f-]+$/i.test(pathname)) return { path: '/livro', title: 'Livro' };
  const pages: Record<string, string> = { '/estante': 'Estante', '/lendo': 'Lendo', '/quero-ler': 'Quero ler', '/adicionar': 'Adicionar', '/mais': 'Mais', '/dados': 'Seus dados', '/configuracoes': 'Configurações', '/instalar': 'Instalar', '/apoiar': 'Apoiar' };
  return pages[pathname] ? { path: pathname, title: pages[pathname] } : null;
}
function command(...args: Command) {
  // gtag.js consumes the native Arguments object used by Google's standard snippet.
  function queue(..._values: Command) { tag().dataLayer?.push(arguments); }
  queue(...args);
}
function clearCookies() {
  const names = document.cookie.split(';').map(item => item.trim().split('=')[0]).filter(name => name === '_ga' || name.startsWith('_ga_'));
  const domain = location.hostname === 'livroalivro.app.br' || location.hostname.endsWith('.livroalivro.app.br') ? '; Domain=livroalivro.app.br' : '';
  for (const name of names) {
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    if (domain) document.cookie = `${name}=; Max-Age=0; Path=/${domain}; SameSite=Lax`;
  }
}
export function suspendAnalytics() {
  generation++; tag()[DISABLE] = true;
  if (tag().dataLayer) command('consent', 'update', consent('denied'));
}
export function disableAnalytics() { suspendAnalytics(); clearCookies(); }
export async function enableAnalytics(pathname = '/estante'): Promise<boolean> {
  const mine = ++generation; tag()[DISABLE] = false;
  if (!tag().dataLayer) {
    tag().dataLayer = [];
    tag().gtag = (...args: Command) => command(...args);
    command('consent', 'default', consent('denied'));
    command('js', new Date());
  }
  command('consent', 'update', consent('granted'));
  const route = publicPage(pathname) ?? { path: '/', title: 'Livro a Livro' };
  const page = { page_title: route.title, page_location: `${location.origin}${route.path}`, page_path: route.path, page_referrer: '' };
  command('set', page);
  if (!configured) {
    const cookieDomain = location.hostname === 'livroalivro.app.br' || location.hostname.endsWith('.livroalivro.app.br') ? 'livroalivro.app.br' : 'auto';
    command('config', MEASUREMENT_ID, { ...page, send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      cookie_domain: cookieDomain, cookie_path: '/', cookie_expires: 30 * 86400 });
    configured = true;
  }
  if (script?.dataset.loaded === 'yes') return mine === generation && !tag()[DISABLE];
  if (!script) {
    script = document.createElement('script'); script.async = true; script.src = SCRIPT_URL; script.referrerPolicy = 'no-referrer';
    document.head.appendChild(script);
  }
  return await new Promise<boolean>(resolve => {
    const current = script!;
    const success = () => { current.dataset.loaded = 'yes'; cleanup(); resolve(mine === generation && !tag()[DISABLE]); };
    const failure = () => { cleanup(); if (script === current) { current.remove(); script = undefined; } suspendAnalytics(); resolve(false); };
    const timeout = window.setTimeout(failure, 8000);
    const cleanup = () => { window.clearTimeout(timeout); current.removeEventListener('load', success); current.removeEventListener('error', failure); };
    current.addEventListener('load', success, { once: true }); current.addEventListener('error', failure, { once: true });
  });
}
export function recordPublicPage(pathname: string) {
  const page = publicPage(pathname);
  if (!page || tag()[DISABLE] || script?.dataset.loaded !== 'yes') return;
  const safe = { page_title: page.title, page_location: `${location.origin}${page.path}`, page_path: page.path, page_referrer: '' };
  command('set', safe); command('event', 'page_view', safe);
}
