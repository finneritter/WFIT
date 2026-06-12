// Page-scoped topbar search plumbing. App owns the input state; routes read the
// deferred, page-scoped query via usePageSearch(). Market additionally registers
// a keyboard handler so ArrowUp/Down/Enter typed in the topbar input drive its
// result-row highlight (useSearchKeys).
import {
  type MutableRefObject,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
} from "react";

export type SearchKeyHandler = (e: React.KeyboardEvent) => void;

interface SearchCtx {
  /** deferred query, already stripped of global (`all:`/`inv:`) mode — "" there */
  query: string;
  /** the active screen's keyboard handler for topbar Arrow/Enter keys */
  keysRef: MutableRefObject<SearchKeyHandler | null>;
}

const Ctx = createContext<SearchCtx | null>(null);

export function SearchProvider({
  query,
  keysRef,
  children,
}: {
  query: string;
  keysRef: MutableRefObject<SearchKeyHandler | null>;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ query, keysRef }), [query, keysRef]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useSearchCtx(): SearchCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePageSearch/useSearchKeys outside <SearchProvider>");
  return ctx;
}

/** The topbar query scoped to the current page ("" when global mode is active). */
export function usePageSearch(): string {
  return useSearchCtx().query;
}

/** Register the active screen's handler for Arrow/Enter keys typed in the topbar
 *  input. Re-registers every render (latest-closure pattern), unregisters on
 *  unmount so a swapped-in view stops receiving keys. */
export function useSearchKeys(handler: SearchKeyHandler): void {
  const { keysRef } = useSearchCtx();
  useEffect(() => {
    keysRef.current = handler;
    return () => {
      if (keysRef.current === handler) keysRef.current = null;
    };
  });
}
