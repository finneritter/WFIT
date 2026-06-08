// Clipboard write — prefers the Tauri plugin (reliable under WebKitGTK), with a
// web-API fallback so a missing capability/plugin degrades gracefully.
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export async function copyText(text: string): Promise<boolean> {
  try {
    await writeText(text);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}
