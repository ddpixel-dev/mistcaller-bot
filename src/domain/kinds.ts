import type { ContentType, Result } from "./types.ts";

// ADR 0010: a fixed list in code. Changing it is an edit and a deploy.
export type KindDef = { id: string; label: string; type: ContentType; color: number };

export const DEFAULT_KIND = "other";
export const TYPE_LABEL: Record<ContentType, string> = { pvp: "PvP", pve: "PvE", pvx: "PvX" };

export const KINDS: KindDef[] = [
  { id: "zvz", label: "ZvZ", type: "pvp", color: 0x1c3a8a },
  { id: "small-scale", label: "Small-scale", type: "pvp", color: 0x2b4db0 },
  { id: "gank-squad", label: "Gank Squad", type: "pvp", color: 0x8a2f4f },
  { id: "bomb-squad", label: "Bomb Squad", type: "pvp", color: 0xa0522d },
  { id: "hellgate", label: "Hellgate", type: "pvp", color: 0x7a1f2b },
  { id: "faction-warfare", label: "Faction Warfare", type: "pvp", color: 0x3b6fd1 },
  { id: "crystal-league", label: "Crystal League", type: "pvp", color: 0x5b8ee6 },
  { id: "arena", label: "Arena", type: "pvp", color: 0x4a5fa8 },
  { id: "skirmish", label: "Skirmish", type: "pvp", color: 0x2f6f9f },
  { id: "training", label: "Training", type: "pvp", color: 0x6d7fa3 },
  { id: DEFAULT_KIND, label: "Other", type: "pvp", color: 0x2b4db0 },
  { id: "group-dungeon", label: "Group dungeon", type: "pve", color: 0xc9a227 },
  { id: "avalonian-dungeon", label: "Avalonian dungeon", type: "pve", color: 0xb8860b },
  { id: "mists", label: "Mists", type: "pve", color: 0x8f9e3a },
  { id: "corrupted-dungeon", label: "Corrupted dungeon", type: "pve", color: 0x9c5a1a },
  { id: "world-boss", label: "World boss", type: "pve", color: 0xd4a017 },
  { id: "fame-farming", label: "Fame farming", type: "pve", color: 0xe0b84a },
  { id: DEFAULT_KIND, label: "Other", type: "pve", color: 0xc9a227 },
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

// Distinct choices for the slash command. "Other" is shared by both types.
export function kindChoices(): { name: string; value: string }[] {
  const seen = new Set<string>();
  const out: { name: string; value: string }[] = [];
  for (const k of KINDS) {
    if (seen.has(k.id)) continue;
    seen.add(k.id);
    out.push({
      name: k.id === DEFAULT_KIND ? "Other" : `${k.label} (${k.type === "pvp" ? "PvP" : "PvE"})`,
      value: k.id,
    });
  }
  return out;
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
