import type { Sql } from "./client.ts";
import type { ContentType, SlotDef } from "../domain/types.ts";

export const MAX_PRESETS = 25;

// What a preset keeps besides the slots (ADR 0039). Never the start time: a date saved last week would be wrong today.
export type PresetSettings = {
  type: ContentType | null; kind: string | null; loot: boolean; selection: boolean;
  title: string | null; tier: string | null; notes: string | null; buildRef: string | null;
};
export type Preset = { id: string; name: string; slots: SlotDef[]; createdBy: string; settings: PresetSettings | null };

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.slice(0, max) : null);

// Read defensively: the column is free-form JSON, and older presets have none.
export function toSettings(raw: unknown): PresetSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    type: r.type === "pvp" || r.type === "pve" || r.type === "pvx" ? r.type : null,
    kind: text(r.kind, 40), loot: r.loot === true, selection: r.selection === true,
    title: text(r.title, 100), tier: text(r.tier, 80), notes: text(r.notes, 500), buildRef: text(r.buildRef, 100),
  };
}

const toPreset = (r: Record<string, any>): Preset => ({
  id: r.id,
  name: r.name,
  slots: r.slots as SlotDef[],
  createdBy: r.created_by,
  settings: toSettings(r.settings),
});

// Saves a preset; a name that exists (ignoring case) is replaced with the new slots (ADR 0039).
export async function savePreset(
  sql: Sql,
  a: { guildId: string; name: string; slots: SlotDef[]; createdBy: string; settings?: PresetSettings | null },
): Promise<"ok" | "replaced" | "full"> {
  return await sql.begin(async (tx) => {
    // Serialize saves per guild so the cap cannot be passed by two at once.
    await tx`select pg_advisory_xact_lock(hashtext(${"preset:" + a.guildId}))`;
    const [{ n }] = await tx`select count(*)::int as n from slot_preset where guild_id = ${a.guildId}`;
    const [dup] = await tx`select id from slot_preset where guild_id = ${a.guildId} and lower(name) = lower(${a.name})`;
    if (dup) {
      await tx`update slot_preset set slots = ${tx.json(a.slots as never)}, settings = ${a.settings ? tx.json(a.settings as never) : null}, created_by = ${a.createdBy} where id = ${dup.id}`;
      return "replaced" as const;
    }
    if (n >= MAX_PRESETS) return "full" as const;
    await tx`
      insert into slot_preset (guild_id, name, slots, settings, created_by)
      values (${a.guildId}, ${a.name}, ${tx.json(a.slots as never)}, ${a.settings ? tx.json(a.settings as never) : null}, ${a.createdBy})`;
    return "ok" as const;
  });
}

export async function listPresets(sql: Sql, guildId: string): Promise<Preset[]> {
  const rows = await sql`select * from slot_preset where guild_id = ${guildId} order by lower(name)`;
  return rows.map(toPreset);
}

export async function getPreset(sql: Sql, guildId: string, name: string): Promise<Preset | null> {
  const [r] = await sql`select * from slot_preset where guild_id = ${guildId} and lower(name) = lower(${name})`;
  return r ? toPreset(r) : null;
}

export async function deletePreset(sql: Sql, guildId: string, id: string): Promise<boolean> {
  return (await sql`delete from slot_preset where guild_id = ${guildId} and id = ${id} returning id`).length > 0;
}

export async function getPresetById(sql: Sql, guildId: string, id: string): Promise<Preset | null> {
  const [r] = await sql`select * from slot_preset where guild_id = ${guildId} and id = ${id}`;
  return r ? toPreset(r) : null;
}
