import type { BackupParser } from '../backup/worker-parser';
import { createBackupService, type ImportPreview } from './backup-service';
import type { LibraryRepository, PortablePreferences, Snapshot } from '../ports/library-repository';
import { createLibraryService } from './library-service';
import { createCatalogService } from './catalog-service';

export type ShelfState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; snapshot: Snapshot; preferences: PortablePreferences; preferenceError: boolean };

/** Committed books plus unsaved preference intentions, tracked independently per field. */
export function createShelfService(repository: LibraryRepository, parser?: BackupParser, holdReload?: () => (() => void) | null) {
  const backup = createBackupService(repository, parser?.parse, parser?.cancel);
  let state: ShelfState = { status: 'loading' };
  let disposed = false;
  let request = 0;
  let preferenceEdit = 0;
  let preferenceQueue = Promise.resolve();
  let releasePreferenceHold: (() => void) | undefined;
  const releaseSettledPreferences = () => { if (overlay.size === 0) { releasePreferenceHold?.(); releasePreferenceHold = undefined; } };
  const preferenceFields = ['shelfYear', 'mode', 'filter', 'sortOrder'] as const;
  const overlay = new Map<keyof PortablePreferences, { sequence: number; value: PortablePreferences[keyof PortablePreferences]; failed: boolean }>();
  const hasPreferenceError = () => [...overlay.values()].some(value => value.failed);
  const withOverlay = (persisted: PortablePreferences): PortablePreferences => ({ ...persisted,
    ...Object.fromEntries([...overlay].map(([field, intent]) => [field, intent.value])),
  });
  const listeners = new Set<() => void>();
  const publish = (next: ShelfState) => {
    if (disposed) return;
    state = next;
    listeners.forEach((listener) => listener());
  };

  async function refresh() {
    const ticket = ++request;
    try {
      await preferenceQueue;
      const [{ books, version, preferences }, localPreferences] = await Promise.all([repository.readBackupSnapshot(), repository.readPreferences()]);
      if (ticket !== request || disposed) return;
      publish({ status: 'ready', snapshot: { books, version },
        preferences: withOverlay({ ...preferences, mode: localPreferences.mode, sortOrder: localPreferences.sortOrder }), preferenceError: hasPreferenceError() });
    } catch {
      if (ticket === request) publish({ status: 'error' });
    }
  }

  const unsubscribe = repository.subscribe(() => { void refresh(); });
  const unsubscribeLocalPreferences = repository.subscribeLocalPreferences(() => { void refresh(); });
  return {
    books: createLibraryService(repository),
    catalog: createCatalogService(repository),
    backup: { ...backup, async confirmImport(preview: ImportPreview) {
      const priorEdit = preferenceEdit;
      await preferenceQueue;
      const version = await backup.confirmImport(preview);
      // The explicit import supersedes earlier unsaved choices, never a later interaction.
      for (const [field, intent] of overlay) if (intent.sequence <= priorEdit) overlay.delete(field);
      releaseSettledPreferences();
      await refresh();
      return version;
    } },
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    updatePreferences(patch: Partial<PortablePreferences>) {
      if (state.status !== 'ready') return;
      if (!releasePreferenceHold && holdReload) {
        const release = holdReload(); if (!release) return; releasePreferenceHold = release;
      }
      ++request; // Even a no-op write must invalidate reads started before this interaction.
      const sequence = ++preferenceEdit;
      const selected = preferenceFields.filter(field => patch[field] !== undefined);
      const queued = Object.fromEntries(selected.map(field => [field, patch[field]])) as Partial<PortablePreferences>;
      for (const field of selected) overlay.set(field, { sequence, value: queued[field]!, failed: overlay.get(field)?.failed ?? false });
      publish({ ...state, preferences: withOverlay(state.preferences), preferenceError: hasPreferenceError() });
      // A completion only settles the exact field intention it was scheduled to save.
      preferenceQueue = preferenceQueue.then(async () => {
        try {
          await repository.updatePreferences(queued);
          for (const field of selected) if (overlay.get(field)?.sequence === sequence) overlay.delete(field);
        } catch {
          for (const field of selected) {
            const intent = overlay.get(field);
            if (intent?.sequence === sequence) intent.failed = true;
          }
        }
        if (state.status === 'ready') publish({ ...state, preferences: withOverlay(state.preferences), preferenceError: hasPreferenceError() });
        releaseSettledPreferences();
        // A preference write can invalidate a read started by a preceding book commit.
        // No-op writes do not notify the repository, so always read the committed shelf.
        void refresh();
      });
    },
    close() { releasePreferenceHold?.(); releasePreferenceHold = undefined; backup.cancelImport(); disposed = true; ++request; unsubscribe(); unsubscribeLocalPreferences(); listeners.clear(); repository.close(); },
  };
}

export type ShelfService = ReturnType<typeof createShelfService>;
