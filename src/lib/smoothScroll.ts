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

// True when the wheel started inside a scrollable element (between the target and
// `stop`) that can still scroll in this direction — e.g. an open dropdown's option
// list. Those events must scroll that element natively, not be hijacked to scroll
// the page; without this, inner menus (the riven stat picker, weapon combobox)
// can't be wheeled because this content-level handler preventDefaults them.
function innerScrollerCanScroll(
  start: EventTarget | null,
  stop: HTMLElement,
  deltaY: number,
): boolean {
  let node = start instanceof HTMLElement ? start : ((start as Node | null)?.parentElement ?? null);
  while (node && node !== stop) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight + 1) {
      const atTop = node.scrollTop <= 0;
      const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
      if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) return true;
    }
    node = node.parentElement;
  }
  return false;
}

export function attachSmoothScroll(el: HTMLElement): () => void {
  let target = el.scrollTop;
  let raf: number | null = null;

  const tick = () => {
    // The content can shrink between wheel events (a filter narrowing the list);
    // clamp so a stale target can't strand past the new bottom and snap upward.
    target = Math.min(target, Math.max(0, el.scrollHeight - el.clientHeight));
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
    // While a modal is open, don't intercept the wheel: let the modal's own
    // scroller handle it natively. The page behind can't scroll because
    // `body.modal-open .content` is locked to overflow:hidden. (Without this the
    // programmatic scrollTop below scrolls the page even under overflow:hidden.)
    if (document.body.classList.contains("modal-open")) {
      target = el.scrollTop;
      return;
    }
    if (!isMouseWheel(e)) {
      // Keep target in sync so the next wheel tick doesn't snap backwards
      // to a stale value left over from a previous mouse-wheel animation.
      target = el.scrollTop;
      return;
    }
    // An open dropdown/list under the cursor scrolls itself natively.
    if (innerScrollerCanScroll(e.target, el, e.deltaY)) {
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
