import type { Sql } from "./client.ts";
import type { SlotDef } from "../domain/types.ts";

export const MAX_PRESETS = 25;

export type Preset = { id: string; name: string; slots: SlotDef[]; createdBy: string };

const toPreset = (r: Record<string, any>): Preset => ({
  id: r.id,
  name: r.name,
  slots: r.slots as SlotDef[],
  createdBy: r.created_by,
});

export async function savePreset(
  sql: Sql,
  a: { guildId: string; name: string; slots: SlotDef[]; createdBy: string },
): Promise<"ok" | "exists" | "full"> {
  return await sql.begin(async (tx) => {
    // Serialize saves per guild so the cap cannot be passed by two at once.
    await tx`select pg_advisory_xact_lock(hashtext(${"preset:" + a.guildId}))`;
    const [{ n }] = await tx`select count(*)::int as n from slot_preset where guild_id = ${a.guildId}`;
    const [dup] = await tx`select 1 as x from slot_preset where guild_id = ${a.guildId} and lower(name) = lower(${a.name})`;
    if (dup) return "exists" as const;
    if (n >= MAX_PRESETS) return "full" as const;
    await tx`
      insert into slot_preset (guild_id, name, slots, created_by)
      values (${a.guildId}, ${a.name}, ${tx.json(a.slots as never)}, ${a.createdBy})`;
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

export async function deletePreset(sql: Sql, guildId: string, name: string): Promise<boolean> {
  const rows = await sql`
    delete from slot_preset where guild_id = ${guildId} and lower(name) = lower(${name}) returning id`;
  return rows.length > 0;
}

export async function searchPresetNames(sql: Sql, guildId: string, text: string): Promise<string[]> {
  const like = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await sql`
    select name from slot_preset where guild_id = ${guildId} and name ilike ${like}
    order by lower(name) limit 25`;
  return rows.map((r) => r.name as string);
}
