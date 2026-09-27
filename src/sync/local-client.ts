/** Development-only transport. The production build must not contain this module. */
export function localTransport(): typeof fetch {
  const base = new URL(import.meta.env.VITE_LOCAL_API_URL || 'http://127.0.0.1:8788');
  if (!import.meta.env.DEV || base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password) throw new Error('LocalModeUnavailable');
  return async (input, init) => {
    const url = new URL(String(input));
    if (!['https://api.livroalivro.app.br', 'https://www.googleapis.com'].includes(url.origin)) throw new Error('LocalHostRefused');
    const response = await fetch(base.origin + url.pathname + url.search, { ...init, credentials: 'omit' });
    return response;
  };
}
