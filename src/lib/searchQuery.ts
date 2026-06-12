// DIM-style search grammar: whitespace-separated terms AND together.
//   term       := '-'? atom
//   atom       := comparison | keyword | text
//   comparison := IDENT op number       op ∈ { > >= < <= = }    plat>10  delta<-5
//   keyword    := IDENT ':' value                               is:vaulted  cat:mod
//   text       := WORD | QUOTED                                 ash  "ash prime"
// The grammar is forgiving while typing: an unknown key degrades to free text and
// a trailing incomplete term (`plat>`, `is:`) is a no-op, so the list never
// flashes empty mid-keystroke.

export type Cmp = ">" | ">=" | "<" | "<=" | "=";

export type Clause =
  | { type: "text"; value: string; neg: boolean }
  | { type: "kv"; key: string; value: string; neg: boolean }
  | { type: "cmp"; key: string; op: Cmp; value: number; neg: boolean };

export type FieldKind = "enum" | "number" | "text";

export interface FieldDef<Row> {
  kind: FieldKind;
  get: (row: Row) => string | number | null | undefined;
  /** enum only: the valid values (drives autocomplete) */
  values?: readonly string[];
  /** autocomplete description */
  hint?: string;
}

export interface SearchSchema<Row> {
  /** free-text haystack; lowercased once per row by the compiled predicate */
  text: (row: Row) => string;
  /** is:<flag> predicates; negation gives -is:<flag> for free */
  is: Record<string, { test: (row: Row) => boolean; hint?: string }>;
  fields: Record<string, FieldDef<Row>>;
}

/** Any page's schema, for code that only inspects keys/values (autocomplete). */
export type AnySearchSchema = SearchSchema<never>;

export interface CompiledQuery<Row> {
  /** AND of all clauses; an empty query always matches */
  test: (row: Row) => boolean;
  /** positive bare-text terms joined with spaces — drives backend text search */
  freeText: string;
}

/** Split on whitespace, keeping quoted spans (incl. `key:"two words"`) intact.
 *  An unclosed quote runs to the end — correct while the user is still typing. */
function splitTerms(input: string): string[] {
  const terms: string[] = [];
  let cur = "";
  let inQuote = false;
  for (const ch of input) {
    if (ch === '"') {
      inQuote = !inQuote;
      cur += ch;
    } else if (!inQuote && /\s/.test(ch)) {
      if (cur) terms.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur) terms.push(cur);
  return terms;
}

const unquote = (s: string): string => s.replace(/"/g, "");

const CMP_RE = /^([A-Za-z_]+)(>=|<=|>|<|=)(.*)$/;
const KV_RE = /^([A-Za-z_]+):(.*)$/;

function parseTerm(raw: string): Clause | null {
  let body = raw;
  let neg = false;
  // '-' negates only at term start before a non-numeric atom; `-5` stays text.
  if (body.length > 1 && body[0] === "-" && !/[\d.]/.test(body[1])) {
    neg = true;
    body = body.slice(1);
  }
  const cmp = body.match(CMP_RE);
  if (cmp) {
    const val = unquote(cmp[3]).trim();
    if (val === "") return null; // trailing `plat>` while typing — no-op
    const n = Number(val);
    if (Number.isFinite(n))
      return { type: "cmp", key: cmp[1].toLowerCase(), op: cmp[2] as Cmp, value: n, neg };
    return { type: "text", value: unquote(raw).toLowerCase(), neg: false };
  }
  const kv = body.match(KV_RE);
  if (kv) {
    const val = unquote(kv[2]).trim().toLowerCase();
    if (val === "") return null; // trailing `is:` while typing — no-op
    return { type: "kv", key: kv[1].toLowerCase(), value: val, neg };
  }
  const text = unquote(body).trim().toLowerCase();
  return text ? { type: "text", value: text, neg } : null;
}

export function parseQuery(input: string): { clauses: Clause[] } {
  return {
    clauses: splitTerms(input)
      .map(parseTerm)
      .filter((c): c is Clause => c != null),
  };
}

const CMP_FNS: Record<Cmp, (a: number, b: number) => boolean> = {
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  "=": (a, b) => a === b,
};

export function compileQuery<Row>(input: string, schema: SearchSchema<Row>): CompiledQuery<Row> {
  const { clauses } = parseQuery(input);
  // Each predicate gets the row plus the (lazily computed) lowercased haystack.
  const preds: Array<(row: Row, hay: string) => boolean> = [];
  const freeTerms: string[] = [];
  let needsHay = false;

  const asText = (term: string, neg: boolean) => {
    needsHay = true;
    if (!neg) freeTerms.push(term);
    preds.push((_row, hay) => hay.includes(term) !== neg);
  };

  for (const c of clauses) {
    if (c.type === "text") {
      asText(c.value, c.neg);
    } else if (c.type === "kv") {
      if (c.key === "is") {
        const flag = schema.is[c.value];
        if (flag) preds.push((row) => flag.test(row) !== c.neg);
        // unknown flag → no-op (likely mid-typing a longer flag name)
        continue;
      }
      const field = schema.fields[c.key];
      if (!field) {
        asText(`${c.key}:${c.value}`, c.neg); // unknown key → free text
      } else if (field.kind === "number") {
        const n = Number(c.value);
        if (Number.isFinite(n))
          preds.push((row) => {
            const v = field.get(row);
            return (typeof v === "number" && v === n) !== c.neg;
          });
      } else if (field.kind === "enum") {
        preds.push((row) => {
          const v = field.get(row);
          return (v != null && String(v).toLowerCase() === c.value) !== c.neg;
        });
      } else {
        preds.push((row) => {
          const v = field.get(row);
          return (v != null && String(v).toLowerCase().includes(c.value)) !== c.neg;
        });
      }
    } else {
      const field = schema.fields[c.key];
      if (!field || field.kind !== "number") {
        asText(`${c.key}${c.op}${c.value}`, c.neg); // cmp on a non-number → free text
        continue;
      }
      const fn = CMP_FNS[c.op];
      // null/undefined never matches: `plat>10` excludes unpriced rows.
      preds.push((row) => {
        const v = field.get(row);
        return (typeof v === "number" && fn(v, c.value)) !== c.neg;
      });
    }
  }

  const freeText = freeTerms.join(" ");
  if (preds.length === 0) return { test: () => true, freeText };
  const wantHay = needsHay;
  return {
    test: (row: Row) => {
      const hay = wantHay ? schema.text(row).toLowerCase() : "";
      return preds.every((p) => p(row, hay));
    },
    freeText,
  };
}
