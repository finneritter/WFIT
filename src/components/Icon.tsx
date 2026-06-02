// Inline SVG icons, ported verbatim from the wireframe's Icon component.
const PATHS: Record<string, string> = {
  inventory: "M3 7l9-4 9 4-9 4-9-4zm0 5l9 4 9-4M3 17l9 4 9-4",
  sets: "M4 4h7v7H4zM13 13h7v7h-7zM13 4h7v7h-7zM4 13h7v7H4z",
  trends: "M3 17l6-6 4 4 8-8M21 7v6h-6",
  watchlist: "M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 10a3 3 0 110-6 3 3 0 010 6z",
  buy: "M6 6h15l-1.5 9h-12zM6 6L5 3H2m4 3l1.5 9M9 20a1 1 0 11-2 0 1 1 0 012 0zm10 0a1 1 0 11-2 0 1 1 0 012 0z",
  tag: "M20 12l-8 8-9-9V3h8z M7 7h.01",
  coin: "M12 2a10 10 0 100 20 10 10 0 000-20zm0 5v10m-3-7h6",
  timer: "M12 7v5l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z",
  history: "M3 3v6h6M3 9a9 9 0 1 0 3-7L3 5",
  settings: "M12 8a4 4 0 100 8 4 4 0 000-8zm9 4l-2-1m-14 0l-2 1m9-9v3m0 12v3m7-5l-2-1m-10 0l-2 1",
  search: "M11 4a7 7 0 100 14 7 7 0 000-14zm10 17l-5-5",
  refresh: "M3 3v6h6M21 21v-6h-6M21 8a9 9 0 00-15-3M3 16a9 9 0 0015 3",
  box: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  sold: "M7 7h10v10H7zM7 7l10 10",
  plus: "M12 5v14M5 12h14",
  // Inventory view-switcher + toolbar glyphs (spec §6, drawn as a single stroked path).
  grid: "M3.5 3.5h7v7h-7zM13.5 3.5h7v7h-7zM3.5 13.5h7v7h-7zM13.5 13.5h7v7h-7z",
  chips: "M3 5h18v6H3zM3 13h18v6H3z",
  rows: "M4 6h16M4 12h16M4 18h16",
  filter: "M4 5h16l-6 7v5l-4 2v-7z",
  sort: "M5 7h14M5 12h9M5 17h5",
  sliders:
    "M3 8h13M20 8h1M3 16h5M12 16h9M16 8a2 2 0 1 0 4 0 2 2 0 1 0 -4 0M8 16a2 2 0 1 0 4 0 2 2 0 1 0 -4 0",
};

export function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.box} />
    </svg>
  );
}
