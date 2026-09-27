import { SearchError, type BookSearch } from '../ports/book-search';

/** One active request per search session; obsolete results cannot reach the form. */
export function createSearchService(provider: BookSearch) {
  let active: { key: string; controller: AbortController; promise: ReturnType<BookSearch['search']> } | null = null;
  function cancel() { active?.controller.abort(); active = null; }
  return { cancel, search(query: string, page = 1) {
    const key = JSON.stringify([query.trim().replace(/\s+/gu, ' '), page]);
    if (active?.key === key) return active.promise;
    cancel();
    const controller = new AbortController();
    const promise = provider.search(query, page, controller.signal).then((result) => {
      if (controller.signal.aborted) throw new SearchError('cancelled');
      return result;
    }).finally(() => { if (active?.controller === controller) active = null; });
    active = { key, controller, promise };
    return promise;
  } };
}
