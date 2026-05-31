import { getCurrentWindow } from "@tauri-apps/api/window";

// Custom window chrome for the frameless window (decorations:false in
// tauri.conf.json). The bar itself is the drag region; the control buttons
// opt out of dragging so they stay clickable.
const win = getCurrentWindow();

export function TitleBar() {
  return (
    <div className="titlebar" data-tauri-drag-region>
      <span className="tb-title" data-tauri-drag-region>
        WFIT — Warframe Item Tracker
      </span>
      <div className="tb-ctl">
        <button type="button" className="tb-btn" title="Minimize" onClick={() => win.minimize()}>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <line x1="2" y1="6" x2="10" y2="6" />
          </svg>
        </button>
        <button
          type="button"
          className="tb-btn"
          title="Maximize"
          onClick={() => win.toggleMaximize()}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <rect x="2.5" y="2.5" width="7" height="7" fill="none" />
          </svg>
        </button>
        <button type="button" className="tb-btn close" title="Close" onClick={() => win.close()}>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <line x1="3" y1="3" x2="9" y2="9" />
            <line x1="9" y1="3" x2="3" y2="9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
