// Compiled only by build-drive-qa.mjs. Normal production transport is unchanged.
import { limitedJson } from '../src/sync/network';

export function createQaFetch(namespace) {
  const allowedFiles = new Set();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let blocked = false;
  function stop() {
    blocked = true;
    const banner = document.querySelector('.qa-banner');
    if (banner) banner.textContent = 'Validação interrompida: arquivo remoto desconhecido bloqueado antes do download. Use uma conta sem dados prévios do Livro a Livro.';
    throw new Error('QA_UNKNOWN_REMOTE_STOP');
  }
  function known(operation) {
    return typeof operation === 'string' && uuid.test(operation) && localStorage.getItem(`${namespace}:operation:${operation}`) === '1';
  }
  return async function qaFetch(input, init = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== 'https://www.googleapis.com') return fetch(input, init);
    if (blocked) return stop();
    const method = init.method ?? (input instanceof Request ? input.method : 'GET');
    if (method === 'POST' && url.pathname === '/upload/drive/v3/files') {
      let metadata;
      try { metadata = JSON.parse(init.body); } catch { return stop(); }
      const operation = metadata?.appProperties?.operationId;
      if (metadata?.name !== 'livro-a-livro-snapshot-v1.json' || metadata?.parents?.length !== 1 ||
        metadata.parents[0] !== 'appDataFolder' || !['1', '2'].includes(metadata?.appProperties?.protocolVersion) || typeof operation !== 'string' || !uuid.test(operation)) return stop();
      // Separate keys avoid overwriting another tab's concurrent operation registration.
      localStorage.setItem(`${namespace}:operation:${operation}`, '1');
    } else if (method === 'PUT' && url.pathname === '/upload/drive/v3/files') {
      let snapshot;
      try { snapshot = JSON.parse(init.body); } catch { return stop(); }
      if (![1, 2].includes(snapshot?.protocolVersion) || !known(snapshot?.operationId)) return stop();
    } else if (method === 'GET' && url.pathname.startsWith('/drive/v3/files/')) {
      if (!allowedFiles.has(url.pathname.slice('/drive/v3/files/'.length))) return stop();
    } else if (method !== 'GET' || url.pathname !== '/drive/v3/files') return stop();
    const response = await fetch(input, init);
    if (response.ok && method === 'GET' && url.pathname === '/drive/v3/files') {
      const page = await limitedJson(response.clone(), 2 * 1024 * 1024);
      if (!Array.isArray(page?.files) || page.files.length > 1000) return stop();
      // Inspect only metadata; never return an unknown file to the app's list/download path.
      for (const file of page.files) {
        if (typeof file.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(file.id) || !known(file.appProperties?.operationId)) return stop();
      }
      for (const file of page.files) allowedFiles.add(file.id);
    }
    return response;
  };
}
