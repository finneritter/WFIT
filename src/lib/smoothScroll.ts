// Smooth-scroll mouse wheel events on a target element. Trackpad scrolling
// passes through to the native scroller — macOS already animates it, and any
// JS interpolation just adds perceptible lag on top.
//
// Detection: line-mode wheel events are always legacy mice; pixel-mode events
// with large integer deltaY (~100/120 per click) are mouse wheels too. Anything
// else (small / fractional pixel deltas, momentum tails) is treated as trackpad.

const EASE = 0.18;
const MIN_DELTA = 0.5;

function isMouseWheel(e: WheelEvent): boolean {
  if (e.deltaMode === 1) return true;
  return Math.abs(e.deltaY) >= 50 && e.deltaY === Math.trunc(e.deltaY);
}

export function attachSmoothScroll(el: HTMLElement): () => void {
  let target = el.scrollTop;
  let raf: number | null = null;

  const tick = () => {
    const diff = target - el.scrollTop;
    if (Math.abs(diff) < MIN_DELTA) {
      el.scrollTop = target;
      raf = null;
      return;
    }
    el.scrollTop += diff * EASE;
    raf = requestAnimationFrame(tick);
  };

  const onWheel = (e: WheelEvent) => {
    if (!isMouseWheel(e)) {
      // Keep target in sync so the next wheel tick doesn't snap backwards
      // to a stale value left over from a previous mouse-wheel animation.
      target = el.scrollTop;
      return;
    }
    e.preventDefault();
    const max = el.scrollHeight - el.clientHeight;
    target = Math.max(0, Math.min(max, target + e.deltaY));
    if (raf == null) raf = requestAnimationFrame(tick);
  };

  el.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    el.removeEventListener("wheel", onWheel);
    if (raf != null) cancelAnimationFrame(raf);
  };
}
