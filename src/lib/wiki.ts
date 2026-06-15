// In-app wiki browser. The Warframe wiki blocks iframing (X-Frame-Options: DENY) but
// renders fine as server-side HTML in a dedicated, reused Tauri WebviewWindow.
// (warframe.market is a client-side SPA that won't render in WebKitGTK, so the Market
// button navigates to the in-app Market view instead — see Drawer/Market.)
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as openExternal } from "@tauri-apps/plugin-shell";

/** Open a remote page in a frameless, reused in-app window (one per `label`). It's
 *  frameless (the native GTK titlebar is huge and we can't put a custom bar on a
 *  remote page), so it auto-dismisses when you click back to WFIT — open it, read,
 *  click the app to close. */
async function openInAppWindow(label: string, url: string, title: string): Promise<void> {
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    try {
      await existing.close();
    } catch {
      // ignore — proceed to recreate
    }
  }
  const w = new WebviewWindow(label, {
    url,
    title,
    width: 1000,
    height: 840,
    decorations: false, // no oversized GTK header on a remote page
    focus: true,
  });
  w.once("tauri://error", (e) => console.error(`${label} window error`, e));
  // Close once it loses focus — but only after it has actually been focused, so
  // the creation moment doesn't close it instantly.
  let sawFocus = false;
  void w.onFocusChanged(({ payload: focused }) => {
    if (focused) {
      sawFocus = true;
    } else if (sawFocus) {
      w.close().catch(() => {});
    }
  });
}

/** Item name → wiki page title. Prime parts live on their base "<X> Prime" page,
 *  so trim everything after "Prime"; other items use their own name. */
export function wikiPage(name: string): string {
  const m = name.match(/^(.*?\bPrime)\b/i);
  return (m ? m[1] : name).trim().replace(/ /g, "_");
}

export function wikiUrl(name: string): string {
  // encode but keep "/" readable for the few titles that contain it
  const page = encodeURIComponent(wikiPage(name)).replace(/%2F/g, "/");
  return `https://wiki.warframe.com/w/${page}`;
}

/** Open the item's wiki page in the in-app window. */
export function openWiki(name: string): Promise<void> {
  return openInAppWindow("wiki", wikiUrl(name), "Wiki — WFIT");
}

/** warframe.market item page. `slug` is the wfm `url_name` (catalog is sourced from
 *  `/v2/items`); the page is rank-agnostic, so `/items/<slug>` is right for all goods. */
export function marketUrl(slug: string): string {
  return `https://warframe.market/items/${encodeURIComponent(slug)}`;
}

/** Open the item's warframe.market page in the system browser. (Its SPA won't render
 *  in the embedded webview, so this is the external-browser path.) */
export function openMarketExternal(slug: string): Promise<void> {
  return openExternal(marketUrl(slug));
}
