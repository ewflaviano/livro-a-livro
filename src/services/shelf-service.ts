import type { LibraryRepository, PortablePreferences, Snapshot } from '../ports/library-repository';
import { createLibraryService } from './library-service';

export type ShelfState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; snapshot: Snapshot; preferences: PortablePreferences; preferenceError: boolean };

/** A projection of committed local data. Preferences never write a library snapshot. */
export function createShelfService(repository: LibraryRepository) {
  let state: ShelfState = { status: 'loading' };
  let disposed = false;
  let request = 0;
  let preferenceEdit = 0;
  let preferenceQueue = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (next: ShelfState) => {
    if (disposed) return;
    state = next;
    listeners.forEach((listener) => listener());
  };

  async function refresh() {
    const ticket = ++request;
    const edit = preferenceEdit;
    try {
      await preferenceQueue;
      // One transaction includes books, revision and restored preferences.
      const { books, version, preferences } = await repository.readBackupSnapshot();
      if (ticket !== request || disposed) return;
      publish({ status: 'ready', snapshot: { books, version },
        preferences: edit !== preferenceEdit && state.status === 'ready' ? state.preferences : preferences,
        preferenceError: state.status === 'ready' && state.preferenceError });
    } catch {
      if (ticket === request) publish({ status: 'error' });
    }
  }

  const unsubscribe = repository.subscribe(() => { void refresh(); });
  return {
    books: createLibraryService(repository),
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    updatePreferences(patch: Partial<PortablePreferences>) {
      if (state.status !== 'ready') return;
      ++preferenceEdit;
      publish({ ...state, preferences: { ...state.preferences, ...patch }, preferenceError: false });
      // Preserve interaction order in this tab; the adapter merges only these fields.
      preferenceQueue = preferenceQueue.then(async () => {
        try { await repository.updatePreferences(patch); }
        catch { if (state.status === 'ready') publish({ ...state, preferenceError: true }); }
      });
    },
    close() { disposed = true; ++request; unsubscribe(); listeners.clear(); repository.close(); },
  };
}

export type ShelfService = ReturnType<typeof createShelfService>;
