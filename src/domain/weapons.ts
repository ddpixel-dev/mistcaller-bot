// Weapon data from ao-bin-dumps (ADR 0009, 0015). Pure: no network, no database.
export type WeaponSlot = "main" | "2h" | "off";
export type Weapon = { base: string; name: string; slot: WeaponSlot; iconTier: number };

const TIER_WORD = /^(Beginner|Novice|Journeyman|Adept|Expert|Master|Grandmaster|Elder)'s /;
const ID = /^T([1-8])_(MAIN|2H|OFF)_([A-Z0-9_]+)$/;
const LINE = /^\s*\d+\s*:\s*(\S+)\s*:\s*(.*)$/;

const SLOT_OF: Record<string, WeaponSlot> = { MAIN: "main", "2H": "2h", OFF: "off" };

// items.txt lines look like "  3: T4_2H_TOOL_TRACKING : Adept's Tracking Toolkit".
export function parseWeapons(text: string): Weapon[] {
  const found = new Map<string, { name: string; slot: WeaponSlot; tiers: number[] }>();
  for (const line of text.split("\n")) {
    const m = LINE.exec(line);
    if (!m) continue;
    const id = ID.exec(m[1]!);
    if (!id || id[3]!.startsWith("TOOL_")) continue;
    const name = m[2]!.replace(/[\u0000-\u001F\u007F]/g, "").trim().replace(TIER_WORD, "");
    if (!name) continue;
    const base = `${id[2]}_${id[3]}`;
    const entry = found.get(base) ?? { name, slot: SLOT_OF[id[2]!]!, tiers: [] };
    entry.tiers.push(Number(id[1]));
    found.set(base, entry);
  }
  return [...found]
    .map(([base, e]) => ({
      base,
      name: e.name,
      slot: e.slot,
      iconTier: e.tiers.includes(4) ? 4 : Math.min(...e.tiers),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.base.localeCompare(b.base));
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Every word typed must appear in the name; names that start with the text come first.
export function searchWeapons(list: Weapon[], query: string, limit = 25): Weapon[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { w: Weapon; rank: number }[] = [];
  for (const w of list) {
    const name = fold(w.name);
    if (!words.every((x) => name.includes(x))) continue;
    scored.push({ w, rank: name.startsWith(words[0]!) ? 0 : 1 });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.w.name.localeCompare(b.w.name))
    .slice(0, limit)
    .map((s) => s.w);
}

// ADR 0013: the icon is linked from Albion's render service, never stored.
export function weaponIconUrl(w: Weapon, size = 64): string {
  return `https://render.albiononline.com/v1/item/T${w.iconTier}_${w.base}.png?size=${size}`;
}

export const SLOT_LABEL: Record<WeaponSlot, string> = { main: "One-handed", "2h": "Two-handed", off: "Off-hand" };
