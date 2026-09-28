import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ShelfService, ShelfState } from '../services/shelf-service';
import type { PortablePreferences } from '../ports/library-repository';
import { openShelfService } from './composition';
import type { LibraryService } from '../services/library-service';

type LibraryContext = {
  state: ShelfState;
  retry: () => void;
  updatePreferences: (patch: Partial<PortablePreferences>) => void;
  positions: Map<string, number>;
  shelfPages: ReadonlyMap<string, { selection: string; page: number }>;
  setShelfPage: (path: string, selection: string, page: number) => void;
  shelfQuery: string;
  setShelfQuery: (query: string) => void;
  books: LibraryService | null;
  backup: ShelfService['backup'] | null;
};
const Context = createContext<LibraryContext | null>(null);
const loading: ShelfState = { status: 'loading' };
const subscribeNothing = () => () => {};
const loadingSnapshot = () => loading;

export function LibraryProvider({ children, openService = openShelfService }: {
  children: ReactNode; openService?: () => Promise<ShelfService>;
}) {
  const [service, setService] = useState<ShelfService | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [shelfQuery, setShelfQuery] = useState('');
  const positions = useRef(new Map<string, number>());
  const [shelfPages, setShelfPages] = useState(() => new Map<string, { selection: string; page: number }>());
  const setShelfPage = useCallback((path: string, selection: string, page: number) => {
    setShelfPages(current => new Map(current).set(path, { selection, page }));
  }, []);
  useEffect(() => {
    let active = true;
    let opened: ShelfService | undefined;
    setFailed(false);
    setService(null);
    void openService().then((next) => {
      if (!active) { next.close(); return; }
      opened = next;
      setService(next);
      void next.refresh();
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; opened?.close(); };
  }, [openService, attempt]);
  const state = useSyncExternalStore(service?.subscribe ?? subscribeNothing, service?.getSnapshot ?? loadingSnapshot);
  return <Context.Provider value={{ state: failed ? { status: 'error' } : state,
    retry: () => { setAttempt((value) => value + 1); },
    updatePreferences: (patch) => service?.updatePreferences(patch), positions: positions.current, shelfPages, setShelfPage, shelfQuery, setShelfQuery, books: service?.books ?? null, backup: service?.backup ?? null,
  }}>{children}</Context.Provider>;
}

export function useLibrary() {
  const context = useContext(Context);
  if (!context) throw new Error('LibraryProvider required');
  return context;
}
