// Local UI preferences (theme/density/etc). Pure presentation — persisted in
// localStorage and applied as body classes the theme.css already keys off.

export type Theme = "dark" | "light";

export interface Prefs {
  theme: Theme;
  dense: boolean;
  flatDeltas: boolean;
}

const KEY = "wfit.prefs";
const DEFAULTS: Prefs = { theme: "dark", dense: false, flatDeltas: false };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function applyPrefs(p: Prefs): void {
  const b = document.body.classList;
  b.toggle("light", p.theme === "light");
  b.toggle("dense", p.dense);
  b.toggle("flat-deltas", p.flatDeltas);
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // ignore quota/availability errors — applying still works for the session
  }
  applyPrefs(p);
}
