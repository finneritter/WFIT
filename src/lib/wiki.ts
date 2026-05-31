// In-app wiki browser. The Warframe wikis block iframing (X-Frame-Options: DENY),
// so we open the page in a dedicated, reused Tauri WebviewWindow instead.
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

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

/** Open (or refocus + navigate) the single shared in-app wiki window. */
export async function openWiki(name: string): Promise<void> {
  const url = wikiUrl(name);
  const existing = await WebviewWindow.getByLabel("wiki");
  if (existing) {
    try {
      await existing.close();
    } catch {
      // ignore — proceed to recreate
    }
  }
  const w = new WebviewWindow("wiki", {
    url,
    title: "Wiki — WFIT",
    width: 1000,
    height: 840,
  });
  w.once("tauri://error", (e) => console.error("wiki window error", e));
}
