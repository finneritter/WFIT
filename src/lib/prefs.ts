// Local UI preferences (theme/density/etc). Pure presentation — persisted in
// localStorage and applied as body classes the theme.css already keys off.

export type Theme = "dark" | "light";

export interface Prefs {
  theme: Theme;
  dense: boolean;
  flatDeltas: boolean;
  /** IANA zone for clock-time displays (Rotation schedules), or "auto" =
   *  follow the PC's zone. Countdowns are relative and unaffected. */
  timezone: string;
}

const KEY = "wfit.prefs";
const DEFAULTS: Prefs = { theme: "dark", dense: false, flatDeltas: false, timezone: "auto" };

/** The PC's current IANA zone (what "auto" resolves to). */
export const systemTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** All selectable zones; falls back to a minimal list on older webviews. */
export function timezoneOptions(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  return typeof intl.supportedValuesOf === "function"
    ? intl.supportedValuesOf("timeZone")
    : ["UTC", systemTimezone()];
}

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
