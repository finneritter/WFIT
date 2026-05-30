import type { Category } from "./types";

/**
 * Split a warframe.market display name into a bold set/frame name + a part sub.
 *   "Mesa Prime Systems"        → { name: "Mesa Prime",  sub: "Systems" }
 *   "Nova Prime Chassis Blueprint" → { name: "Nova Prime", sub: "Chassis Blueprint" }
 *   "Saryn Prime Set"           → { name: "Saryn Prime",  sub: "Set" }
 * Non-prime names fall back to the whole name + the catalog part_type.
 */
export function splitName(
  displayName: string,
  partType: string,
): { name: string; sub: string } {
  const i = displayName.indexOf(" Prime");
  if (i >= 0) {
    const name = displayName.slice(0, i + " Prime".length);
    const sub = displayName.slice(i + " Prime".length).trim() || partType;
    return { name, sub };
  }
  return { name: displayName, sub: partType };
}

const FRAME_PARTS = new Set(["Systems", "Chassis", "Neuroptics"]);
const WEAPON_PARTS = new Set([
  "Blade",
  "Blades",
  "Handle",
  "Barrel",
  "Receiver",
  "Stock",
  "String",
  "Link",
  "Pouch",
  "Disc",
  "Lower limb",
  "Upper limb",
  "Head",
  "Grip",
  "Ornament",
  "Boot",
  "Hilt",
  "Gauntlet",
  "Buckle",
  "Guard",
]);

/** Best-effort Warframe/Weapon classification from the catalog part_type. */
export function categoryFor(partType: string): Category {
  if (FRAME_PARTS.has(partType)) return "Warframe";
  if (WEAPON_PARTS.has(partType)) return "Weapon";
  return "Other";
}
