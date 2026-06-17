// Local UI preferences (theme/density/etc). Pure presentation — persisted in
// localStorage and applied as body classes the theme.css already keys off.

export type Theme = "dark" | "light";

/** UI typeface. "system" = native stack; the rest are bundled woff2 (theme.css). */
export type Font = "system" | "inter" | "lexend" | "atkinson";

export const FONTS: { value: Font; label: string; hint: string }[] = [
  { value: "system", label: "System", hint: "Your OS default UI font" },
  { value: "inter", label: "Inter", hint: "Modern, neutral, very legible at small sizes" },
  { value: "lexend", label: "Lexend", hint: "Engineered to reduce reading fatigue" },
  {
    value: "atkinson",
    label: "Atkinson",
    hint: "Atkinson Hyperlegible — max character distinction",
  },
];

export interface Prefs {
  theme: Theme;
  dense: boolean;
  flatDeltas: boolean;
  /** UI typeface for body/labels. Numbers always stay on the mono stack. */
  font: Font;
  /** IANA zone for clock-time displays (Rotation schedules), or "auto" =
   *  follow the PC's zone. Countdowns are relative and unaffected. */
  timezone: string;
  /** Show the "SCAN" provenance tag on inventory rows imported via the game
   *  memory-scan. Off by default — it's visual clutter for most users. */
  showScanTag: boolean;
}

const KEY = "wfit.prefs";
const DEFAULTS: Prefs = {
  theme: "dark",
  dense: false,
  flatDeltas: false,
  font: "system",
  timezone: "auto",
  showScanTag: false,
};

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
  b.toggle("hide-scan-tag", !p.showScanTag);
  if (p.font === "system") delete document.body.dataset.font;
  else document.body.dataset.font = p.font;
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // ignore quota/availability errors — applying still works for the session
  }
  applyPrefs(p);
}
