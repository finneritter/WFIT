import { useEffect } from "react";

/** Invoke `onClose` when Escape is pressed while the overlay is mounted. Each
 *  overlay renders conditionally, so the listener exists only while it's open.
 *  For nested overlays, only the outer component should call this and route
 *  Escape to the topmost layer (see Drawer) — otherwise both would close at once. */
export function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}
