// DIM-style autocomplete for the topbar search: suggests the active page's
// filter keywords while a bare fragment is being typed, and valid values after
// an `is:`/enum prefix. Keyboard handling is driven by the topbar input via the
// imperative handle (the input keeps focus; this is purely a dropdown).
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { clsx } from "../lib/format";
import type { AnySearchSchema } from "../lib/searchQuery";

export interface SearchSuggestHandle {
  /** Offer a topbar keydown to the dropdown; true = consumed. */
  onKeyDown(e: React.KeyboardEvent): boolean;
}

interface Suggestion {
  insert: string; // replaces the current fragment
  label: string;
  hint?: string;
  /** ends with `:`/`>` — keep the dropdown open for the value, no trailing space */
  partial: boolean;
}

function suggestionsFor(
  input: string,
  schema: AnySearchSchema,
): { frag: string; items: Suggestion[] } {
  const frag = input.match(/(\S+)$/)?.[1] ?? "";
  // nothing typed yet, or mid-quote — keep out of the way
  if (!frag || frag.includes('"')) return { frag, items: [] };
  const neg = frag.startsWith("-") && frag.length > 1 ? "-" : "";
  const body = frag.slice(neg.length).toLowerCase();

  const colon = body.indexOf(":");
  if (colon >= 0) {
    // value position: `is:<partial>` or `<enumKey>:<partial>`
    const key = body.slice(0, colon);
    const partial = body.slice(colon + 1);
    let values: { v: string; hint?: string }[] = [];
    if (key === "is") {
      values = Object.entries(schema.is).map(([v, f]) => ({ v, hint: f.hint }));
    } else {
      const field = schema.fields[key];
      if (field?.kind === "enum" && field.values)
        values = field.values.map((v) => ({ v, hint: field.hint }));
    }
    const items = values
      .filter(({ v }) => v.startsWith(partial) && v !== partial)
      .map(({ v, hint }) => ({
        insert: `${neg}${key}:${v}`,
        label: `${key}:${v}`,
        hint,
        partial: false,
      }));
    return { frag, items };
  }
  // a comparison in progress (`plat>1…`) — numbers are free entry
  if (/[<>=]/.test(body)) return { frag, items: [] };

  const stems: Suggestion[] = [];
  for (const [flag, def] of Object.entries(schema.is)) {
    // match on the stem ("is:v…") or the bare flag name ("vau…")
    if (`is:${flag}`.startsWith(body) || flag.startsWith(body))
      stems.push({
        insert: `${neg}is:${flag}`,
        label: `is:${flag}`,
        hint: def.hint,
        partial: false,
      });
  }
  // alias keys (cat/category) share one FieldDef — suggest only the first
  const seen = new Set<unknown>();
  for (const [key, field] of Object.entries(schema.fields)) {
    if (seen.has(field)) continue;
    seen.add(field);
    const stem = field.kind === "number" ? `${key}>` : `${key}:`;
    if (key.startsWith(body) && stem !== body)
      stems.push({ insert: `${neg}${stem}`, label: stem, hint: field.hint, partial: true });
  }
  if (!neg && "all:".startsWith(body))
    stems.push({ insert: "all:", label: "all:", hint: "search the whole catalog", partial: true });
  return { frag, items: stems };
}

export const SearchSuggest = forwardRef<
  SearchSuggestHandle,
  {
    input: string;
    schema: AnySearchSchema;
    onApply: (next: string) => void;
  }
>(function SearchSuggest({ input, schema, onApply }, ref) {
  const [hi, setHi] = useState(-1);
  // Esc hides the dropdown for the current input; any edit brings it back.
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const { frag, items } = useMemo(() => suggestionsFor(input, schema), [input, schema]);
  const hiRow = useRef<HTMLButtonElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the highlight whenever the input changes
  useEffect(() => setHi(-1), [input]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keep the highlighted row in view
  useEffect(() => {
    hiRow.current?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const open = items.length > 0 && dismissedAt !== input;

  const accept = (s: Suggestion) => {
    const base = input.slice(0, input.length - frag.length);
    onApply(base + s.insert + (s.partial ? "" : " "));
  };

  useImperativeHandle(ref, () => ({
    onKeyDown(e) {
      if (!open) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHi((h) => (h + 1) % items.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHi((h) => (h <= 0 ? items.length - 1 : h - 1));
      } else if (e.key === "Tab") {
        e.preventDefault();
        accept(items[hi >= 0 ? hi : 0]);
      } else if (e.key === "Enter" && hi >= 0) {
        e.preventDefault();
        accept(items[hi]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setDismissedAt(input);
      } else {
        return false; // not ours — fall through to the page handler
      }
      return true;
    },
  }));

  if (!open) return null;
  return (
    <div className="search-results">
      {items.map((s, i) => (
        <button
          key={s.label}
          ref={i === hi ? hiRow : undefined}
          type="button"
          className={clsx("sr-row sg-row", i === hi && "hi")}
          // keep focus in the input so blur doesn't close before the click lands
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => accept(s)}
        >
          <span className="sg-k">{s.label}</span>
          {s.hint ? <span className="sg-hint">{s.hint}</span> : null}
        </button>
      ))}
    </div>
  );
});
