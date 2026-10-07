import { WEAPONS } from "../data/weapons.ts";
import { WEAPON_EMOJI } from "../data/weapon-emoji.ts";
import { emojiFor, emojiTag, type EmojiRef } from "../domain/weaponEmoji.ts";

const BASE_BY_NAME = new Map(WEAPONS.map((w) => [w.name.toLowerCase(), w.base]));

// The emoji for a weapon by its display name (slots store names). Unknown or not-yet-uploaded weapons have none.
export function weaponEmojiByName(name: string, map: Record<string, string> = WEAPON_EMOJI): EmojiRef | undefined {
  const base = BASE_BY_NAME.get(name.trim().toLowerCase());
  return base ? emojiFor(map, base) : undefined;
}

export const weaponEmojiTag = (name: string, map: Record<string, string> = WEAPON_EMOJI): string =>
  emojiTag(weaponEmojiByName(name, map));
