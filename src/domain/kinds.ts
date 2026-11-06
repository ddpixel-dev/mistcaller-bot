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
  { id: "outposts", label: "Outposts", type: "pvp", color: 0x3f7f8f, icon: "🛡️" },
  { id: "castle", label: "Castle", type: "pvp", color: 0x35508f, icon: "🏯" },
  { id: "mists", label: "Mists", type: "pvp", color: 0x5f8f6f, icon: "🌫️" },
  { id: "corrupted-dungeon", label: "Corrupted dungeon", type: "pvp", color: 0x8a4a3a, icon: "💀" },
  { id: "ancient-lands", label: "Ancient Lands", type: "pvp", color: 0x7a5fa8, icon: "🗿" },
  { id: DEFAULT_KIND, label: "Other", type: "pvp", color: 0x2b4db0, icon: "⚔️" },
  { id: "group-dungeon", label: "Group dungeon", type: "pve", color: 0xc9a227, icon: "🏚️" },
  { id: "avalonian-dungeon", label: "Avalonian dungeon", type: "pve", color: 0xb8860b, icon: "🌌" },
  { id: "world-boss", label: "World boss", type: "pve", color: 0xd4a017, icon: "🐉" },
  { id: "static-dungeon", label: "Static dungeon", type: "pve", color: 0xb98a2e, icon: "🏛️" },
  { id: "dragon-sanctuary", label: "Dragon sanctuary", type: "pve", color: 0xc4702a, icon: "🐲" },
  { id: "hellgate", label: "Hellgate", type: "pve", color: 0xa8402a, icon: "🔥" },
  { id: "depths", label: "Depths", type: "pve", color: 0x7b6a3a, icon: "⛏️" },
  { id: "avalonian-raid", label: "Avalonian raid", type: "pve", color: 0xa9830f, icon: "⚔️" },
  { id: "crystal-creatures", label: "Crystal creatures", type: "pve", color: 0xcfa83a, icon: "🔮" },
  { id: "ancient-lands", label: "Ancient Lands", type: "pve", color: 0xbf9b30, icon: "🗿" },
  { id: "ava-gold", label: "Ava Gold", type: "pve", color: 0xe6b422, icon: "💰" },
  { id: "ava-skip", label: "Ava Skip", type: "pve", color: 0xd9a21b, icon: "🛤️" },
  { id: DEFAULT_KIND, label: "Other", type: "pve", color: 0xc9a227, icon: "🐉" },
];

// Categories no longer offered (FR-023, 2026-11-06). Old content keeps its category, so they stay readable for display
// but new content cannot pick them.
const LEGACY_KINDS: KindDef[] = [
  // Moved to PvP on 2026-11-06; PvE content made before keeps its label.
  { id: "mists", label: "Mists", type: "pve", color: 0x8f9e3a, icon: "🌫️" },
  { id: "corrupted-dungeon", label: "Corrupted dungeon", type: "pve", color: 0x9c5a1a, icon: "💀" },
  { id: "fame-farming", label: "Fame farming", type: "pve", color: 0xe0b84a, icon: "🌾" },
  { id: "gold-chest", label: "Avalonian gold chest", type: "pve", color: 0xdaa520, icon: "💰" },
];

// PvX holds every PvP and PvE category (owner decision 2026-10-08), each once.
const PVX_COLOR = 0x6f4fb0;
// A menu holds 25 options, and the PvP and PvE lists together are 27 once a shared id is counted once, so PvX leaves
// out Training and Skirmish (practice and small skirmishes, not mixed content). Content already saved as PvX with one of
// them still shows its label (kindDef).
const PVX_LEFT_OUT = new Set(["training", "skirmish"]);
// Alphabetical by label, Other last (owner request 2026-11-06), in every list including PvX.
const alphabetical = (list: KindDef[]): KindDef[] =>
  [...list.filter((k) => k.id !== DEFAULT_KIND).sort((a, b) => a.label.localeCompare(b.label, "en")), ...list.filter((k) => k.id === DEFAULT_KIND)];

export function kindsOf(type: ContentType): KindDef[] {
  if (type !== "pvx") return alphabetical(KINDS.filter((k) => k.type === type));
  const seen = new Set<string>();
  const all = KINDS.filter((k) => !PVX_LEFT_OUT.has(k.id) && !seen.has(k.id) && !!seen.add(k.id));
  return alphabetical([...all.filter((k) => k.id !== DEFAULT_KIND), ...all.filter((k) => k.id === DEFAULT_KIND).map((k) => ({ ...k, color: PVX_COLOR }))]);
}

// For display: also finds categories that are no longer offered, so an old post keeps its label.
export function kindDef(type: ContentType, id: string): KindDef | null {
  const offered = kindsOf(type).find((k) => k.id === id);
  if (offered) return offered;
  const old = LEGACY_KINDS.find((k) => k.id === id && (type === "pvx" || k.type === type));
  if (old) return old;
  return type === "pvx" ? KINDS.find((k) => k.id === id) ?? null : null;
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
  if (kindsOf(type).some((k) => k.id === id)) return { ok: true, value: id };
  const other = KINDS.find((k) => k.id === id);
  if (other) {
    const here = TYPE_LABEL[type];
    const there = other.type === "pvp" ? "PvP" : "PvE";
    return { ok: false, error: `${other.label} is a ${there} category, but this content is ${here}.` };
  }
  return { ok: false, error: "That category is not on the list." };
}
