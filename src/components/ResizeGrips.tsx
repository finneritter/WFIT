import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

// Drag-to-resize for the frameless window (decorations:false). On Linux/Wayland an
// undecorated window has no OS resize borders, so we overlay thin invisible grips at
// the edges/corners and call the window's startResizeDragging — the resize twin of the
// titlebar's startDragging/data-tauri-drag-region move. Hidden while maximized.
const win = getCurrentWindow();

// `ResizeDirection` values (string enum) accepted by startResizeDragging.
const GRIPS = [
  ["North", "rg-n"],
  ["South", "rg-s"],
  ["East", "rg-e"],
  ["West", "rg-w"],
  ["NorthWest", "rg-nw"],
  ["NorthEast", "rg-ne"],
  ["SouthWest", "rg-sw"],
  ["SouthEast", "rg-se"],
] as const;

export function ResizeGrips() {
  const [maximized, setMaximized] = useState(false);

  // Resizing a maximized window via drag is odd — hide the grips while maximized.
  useEffect(() => {
    let alive = true;
    const sync = () => {
      win.isMaximized().then((m) => {
        if (alive) setMaximized(m);
      });
    };
    sync();
    const un = win.onResized(sync);
    return () => {
      alive = false;
      un.then((f) => f());
    };
  }, []);

  if (maximized) return null;

  return (
    <>
      {GRIPS.map(([dir, cls]) => (
        <div
          key={dir}
          className={`rgrip ${cls}`}
          // Left button only; ignore if it would start while maximized.
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            void win.startResizeDragging(dir);
          }}
        />
      ))}
    </>
  );
}
