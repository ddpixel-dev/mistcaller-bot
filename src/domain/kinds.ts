import type { ContentType, Result } from "./types.ts";

// ADR 0010: a fixed list in code. Changing it is an edit and a deploy.
// icon: shown before the roster title (owner request 2026-10-24, ADR 0030); Other uses the type's icon.
export type KindDef = { id: string; label: string; type: ContentType; color: number; icon: string };

export const DEFAULT_KIND = "other";
export const TYPE_LABEL: Record<ContentType, string> = { pvp: "PvP", pve: "PvE", pvx: "PvX" };
const TYPE_ICON: Record<ContentType, string> = { pvp: "⚔️", pve: "🐉", pvx: "🌀" };

export const KINDS: KindDef[] = [
  { id: "zvz", label: "ZvZ", type: "pvp", color: 0x1c3a8a, icon: "🏰" },
  { id: "small-scale", label: "Small-scale", type: "pvp", color: 0x2b4db0, icon: "⚔️" },
  { id: "gank-squad", label: "Gank Squad", type: "pvp", color: 0x8a2f4f, icon: "🗡️" },
  { id: "bomb-squad", label: "Bomb Squad", type: "pvp", color: 0xa0522d, icon: "💣" },
  { id: "ava-gank", label: "Ava Gank", type: "pvp", color: 0x9b3d5a, icon: "🌑" },
  { id: "hellgate", label: "Hellgate", type: "pvp", color: 0x7a1f2b, icon: "🔥" },
  { id: "faction-warfare", label: "Faction Warfare", type: "pvp", color: 0x3b6fd1, icon: "🚩" },
  { id: "crystal-league", label: "Crystal League", type: "pvp", color: 0x5b8ee6, icon: "💎" },
  { id: "arena", label: "Arena", type: "pvp", color: 0x4a5fa8, icon: "🏟️" },
  { id: "skirmish", label: "Skirmish", type: "pvp", color: 0x2f6f9f, icon: "🤺" },
  { id: "training", label: "Training", type: "pvp", color: 0x6d7fa3, icon: "🎯" },
  { id: DEFAULT_KIND, label: "Other", type: "pvp", color: 0x2b4db0, icon: "⚔️" },
  { id: "group-dungeon", label: "Group dungeon", type: "pve", color: 0xc9a227, icon: "🏚️" },
  { id: "avalonian-dungeon", label: "Avalonian dungeon", type: "pve", color: 0xb8860b, icon: "🌌" },
  { id: "mists", label: "Mists", type: "pve", color: 0x8f9e3a, icon: "🌫️" },
  { id: "corrupted-dungeon", label: "Corrupted dungeon", type: "pve", color: 0x9c5a1a, icon: "💀" },
  { id: "world-boss", label: "World boss", type: "pve", color: 0xd4a017, icon: "🐉" },
  { id: "fame-farming", label: "Fame farming", type: "pve", color: 0xe0b84a, icon: "🌾" },
  { id: "gold-chest", label: "Avalonian gold chest", type: "pve", color: 0xdaa520, icon: "💰" },
  { id: "ava-gold", label: "Ava Gold", type: "pve", color: 0xe6b422, icon: "💰" },
  { id: DEFAULT_KIND, label: "Other", type: "pve", color: 0xc9a227, icon: "🐉" },
];

// PvX holds every PvP and PvE category (owner decision 2026-10-08): the PvP ones first, then the PvE ones, Other once.
const PVX_COLOR = 0x6f4fb0;
export function kindsOf(type: ContentType): KindDef[] {
  if (type !== "pvx") return KINDS.filter((k) => k.type === type);
  const seen = new Set<string>();
  const all = KINDS.filter((k) => !seen.has(k.id) && !!seen.add(k.id));
  return [...all.filter((k) => k.id !== DEFAULT_KIND), ...all.filter((k) => k.id === DEFAULT_KIND).map((k) => ({ ...k, color: PVX_COLOR }))];
}

export function kindDef(type: ContentType, id: string): KindDef | null {
  return kindsOf(type).find((k) => k.id === id) ?? null;
}

export const typeIcon = (type: ContentType): string => TYPE_ICON[type];

// The title icon: the category's own, or the type's for Other and unknown categories.
export function kindIcon(type: ContentType, id: string): string {
  const def = kindDef(type, id);
  return def && def.id !== DEFAULT_KIND ? def.icon : typeIcon(type);
}

// A missing kind means Other. A kind from the other type is refused.
export function resolveKind(type: ContentType, id: string | null): Result<string> {
  if (id === null || id === "") return { ok: true, value: DEFAULT_KIND };
  if (kindDef(type, id)) return { ok: true, value: id };
  const other = KINDS.find((k) => k.id === id);
  if (other) {
    const here = TYPE_LABEL[type];
    const there = other.type === "pvp" ? "PvP" : "PvE";
    return { ok: false, error: `${other.label} is a ${there} category, but this content is ${here}.` };
  }
  return { ok: false, error: "That category is not on the list." };
}
