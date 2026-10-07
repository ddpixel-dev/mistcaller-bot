import type { ContentType, Result } from "./types.ts";

// ADR 0010: a fixed list in code. Changing it is an edit and a deploy.
export type KindDef = { id: string; label: string; type: ContentType; color: number };

export const DEFAULT_KIND = "other";

export const KINDS: KindDef[] = [
  { id: "zvz", label: "ZvZ", type: "pvp", color: 0x1c3a8a },
  { id: "small-scale", label: "Small-scale", type: "pvp", color: 0x2b4db0 },
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

export function kindDef(type: ContentType, id: string): KindDef | null {
  return KINDS.find((k) => k.type === type && k.id === id) ?? null;
}

// Distinct choices for the slash command. "Other" is shared by both forums.
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

// A missing kind means Other. A kind from the other forum type is refused.
export function resolveKind(type: ContentType, id: string | null): Result<string> {
  if (id === null || id === "") return { ok: true, value: DEFAULT_KIND };
  if (kindDef(type, id)) return { ok: true, value: id };
  const other = KINDS.find((k) => k.id === id);
  if (other) {
    const here = type === "pvp" ? "PvP" : "PvE";
    const there = other.type === "pvp" ? "PvP" : "PvE";
    return { ok: false, error: `${other.label} is a ${there} kind, but this post is in the ${here} forum.` };
  }
  return { ok: false, error: "That kind of content is not on the list." };
}
