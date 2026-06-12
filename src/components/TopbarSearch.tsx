// The one search box. On screens with a search schema it filters that screen's
// rows (DIM-style syntax + autocomplete); `all:` — or any schema-less screen —
// switches to the global catalog dropdown (jump to any item). `inv:`/`ininv:`
// remain as global-but-owned-only aliases.
import { type MutableRefObject, useEffect, useRef, useState } from "react";
import type { SearchKeyHandler } from "../lib/searchContext";
import { GLOBAL_PLACEHOLDER, PAGE_PLACEHOLDER, PAGE_SCHEMAS } from "../lib/searchSchemas";
import { Icon } from "./Icon";
import { SearchResults } from "./SearchResults";
import { SearchSuggest, type SearchSuggestHandle } from "./SearchSuggest";
import type { ScreenId } from "./Sidebar";

/** Prefixes that flip the topbar into global catalog mode. */
export const GLOBAL_PREFIX = /^(all|in?inv):\s*/i;

const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement &&
  (t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "SELECT" ||
    t.isContentEditable);

export function TopbarSearch({
  screen,
  search,
  setSearch,
  deferredSearch,
  keysRef,
  onOpen,
}: {
  screen: ScreenId;
  search: string;
  setSearch: (q: string) => void;
  deferredSearch: string;
  keysRef: MutableRefObject<SearchKeyHandler | null>;
  onOpen: (slug: string) => void;
}) {
  const schema = PAGE_SCHEMAS[screen];
  const globalMode = !schema || GLOBAL_PREFIX.test(search);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestRef = useRef<SearchSuggestHandle>(null);
  const [focused, setFocused] = useState(false);

  // "/" focuses the search from anywhere (unless already typing somewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="search-wrap">
      <div className="search">
        <Icon name="search" />
        <input
          ref={inputRef}
          placeholder={PAGE_PLACEHOLDER[screen] ?? GLOBAL_PLACEHOLDER}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            // 1) autocomplete gets first refusal (Arrow/Tab/Enter/Esc while open)
            if (suggestRef.current?.onKeyDown(e)) return;
            // 2) the active screen's handler (Market: highlight + open results)
            if (
              !globalMode &&
              (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter")
            ) {
              keysRef.current?.(e);
              return;
            }
            // 3) Escape clears (after the dropdown has had its close-press)
            if (e.key === "Escape") setSearch("");
          }}
        />
      </div>
      {globalMode && search.trim() ? (
        <SearchResults
          query={deferredSearch}
          onOpen={(slug) => {
            onOpen(slug);
            setSearch("");
          }}
        />
      ) : null}
      {!globalMode && schema && focused && search ? (
        <SearchSuggest ref={suggestRef} input={search} schema={schema} onApply={setSearch} />
      ) : null}
    </div>
  );
}
