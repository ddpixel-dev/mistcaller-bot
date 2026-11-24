// FR-077 (ADR 0049): a slot's role is one of five and its weapon a name from the game's weapon list, off-hands included.
// Pure: the weapon list is generated data, not a network call (NFR-007).
import { WEAPONS } from "../data/weapons.ts";
import { GUIDED_ROLES } from "./guided.ts";
import { searchWeapons } from "./weapons.ts";

export const ROLES_TEXT = "Tank, DTank, Healer, Support or DPS";

// Capitals, spaces, hyphens and apostrophes do not matter: "great axe" is the game's "Greataxe".
const key = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const WEAPON_BY_KEY = new Map(WEAPONS.map((w) => [key(w.name), w.name]));

export function canonicalRole(text: string): string | null {
  const k = key(text);
  return GUIDED_ROLES.find((r) => key(r) === k) ?? null;
}

export function canonicalWeapon(text: string): string | null {
  const k = key(text);
  return k ? WEAPON_BY_KEY.get(k) ?? null : null;
}

// Up to three names close to what was typed: every word typed, else any word of three letters or more.
export function weaponHint(text: string): string {
  let found = searchWeapons(WEAPONS, text, 3).map((w) => w.name);
  if (found.length === 0) {
    const words = text.split(/\s+/).filter((w) => w.length >= 3);
    found = [...new Set(words.flatMap((w) => searchWeapons(WEAPONS, w, 3).map((x) => x.name)))].slice(0, 3);
  }
  if (found.length === 0) return "";
  const list = found.length === 1 ? found[0] : `${found.slice(0, -1).join(", ")} or ${found.at(-1)}`;
  return ` Did you mean ${list}?`;
}
