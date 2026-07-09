import { useRef, useState } from "react";

/** The shared right-side-drawer resize affordance (item Drawer, RelicDrawer,
 *  SetDrawer, Arcanes collection drawer): pointer-drag on a `.drawer-grip`
 *  strip, width clamped to [minWidth, viewport−80], persisted per drawer. */
export function useDrawerResize(storageKey: string, minWidth: number, defaultWidth: number) {
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved >= minWidth ? saved : defaultWidth;
  });
  const widthRef = useRef(width);
  widthRef.current = width;

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(
        Math.max(window.innerWidth - ev.clientX, minWidth),
        window.innerWidth - 80,
      );
      widthRef.current = w;
      setWidth(w);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(storageKey, String(Math.round(widthRef.current)));
      } catch {
        // ignore persistence failures
      }
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return { width, startResize };
}
