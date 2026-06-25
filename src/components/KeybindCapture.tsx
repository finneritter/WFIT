// A small key-combo capture control. Click to arm, then press a shortcut; it
// stores the raw accelerator string in the grammar tauri-plugin-global-shortcut
// expects (e.g. "Alt+KeyC") and shows a prettified form ("Alt + C").
//
// We build the accelerator from `event.code` (physical key — "KeyC", "Digit1",
// "F5"), which is exactly the plugin's token set, plus the live modifier flags.
// At least one modifier is required so a bare key can't be grabbed globally.
import { useState } from "react";

/** Turn a stored accelerator ("Alt+KeyC") into a readable label ("Alt + C"). */
export function prettyAccel(accel: string): string {
  if (!accel) return "";
  return accel
    .split("+")
    .map((part) => {
      if (part === "Control" || part === "Ctrl") return "Ctrl";
      if (part === "CommandOrControl" || part === "CmdOrCtrl") return "Ctrl";
      if (part === "Super" || part === "Meta") return "Super";
      if (part.startsWith("Key")) return part.slice(3); // KeyC → C
      if (part.startsWith("Digit")) return part.slice(5); // Digit1 → 1
      return part; // Alt, Shift, F5, Space, …
    })
    .join(" + ");
}

export function KeybindCapture({
  value,
  onChange,
}: {
  value: string;
  onChange: (accel: string) => void;
}) {
  const [capturing, setCapturing] = useState(false);

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setCapturing(false);
      return;
    }
    // Wait for a real key — ignore lone modifier presses.
    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
    const mods: string[] = [];
    if (e.ctrlKey) mods.push("Control");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    if (e.metaKey) mods.push("Super");
    if (mods.length === 0) return; // require at least one modifier
    onChange([...mods, e.code].join("+"));
    setCapturing(false);
  };

  return (
    <button
      type="button"
      className="chip kb-capture"
      aria-pressed={capturing}
      onClick={() => setCapturing(true)}
      onKeyDown={capturing ? onKeyDown : undefined}
      onBlur={() => setCapturing(false)}
    >
      {capturing ? "Press keys…" : prettyAccel(value) || "Set hotkey"}
    </button>
  );
}
