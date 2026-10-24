import type { Sql } from "./client.ts";
import { type GuidedDraft } from "../domain/guided.ts";
import type { ContentType, SlotDef } from "../domain/types.ts";

export const DRAFT_TTL_MS = 60 * 60 * 1000;

export type StoredDraft = GuidedDraft & {
  id: string;
  guildId: string;
  userId: string;
  threadId: string;
  type: ContentType;
  loot: boolean;
  kind: string;
  buildRef: string | null;
  weaponClass: string | null;
  gearTier: string | null;
};

const toDraft = (r: Record<string, any>): StoredDraft => ({
  id: r.id,
  guildId: r.guild_id,
  userId: r.user_id,
  threadId: r.thread_id,
  type: (r.type === "pve" || r.type === "pvx" ? r.type : "pvp") as ContentType,
  buildRef: r.build_channel_id ?? null,
  loot: r.loot,
  kind: r.kind,
  count: r.count ?? null,
  slots: r.slots as SlotDef[],
  step: r.step ?? 0,
  role: r.role ?? null,
  weapon: r.weapon ?? null,
  duty: r.duty ?? null,
  weaponClass: r.weapon_class ?? null,
  gearTier: r.gear_tier ?? null,
});

// One draft per member per post: starting again replaces the old one. The first create form (ADR 0031) gives the
// number of players (or a preset's slots, which make the draft complete) and the gear tier.
export async function startDraft(
  sql: Sql,
  a: {
    guildId: string; userId: string; threadId: string; type: ContentType; loot: boolean; kind: string; buildRef?: string | null;
    count?: number | null; slots?: SlotDef[]; gearTier?: string | null;
  },
): Promise<string> {
  const slots = a.slots ?? [];
  const count = a.slots ? a.slots.length : a.count ?? null;
  const [row] = await sql`
    insert into slot_draft (guild_id, user_id, thread_id, type, loot, kind, build_channel_id, count, slots, step, gear_tier)
    values (${a.guildId}, ${a.userId}, ${a.threadId}, ${a.type}, ${a.loot}, ${a.kind}, ${a.buildRef ?? null}, ${count},
      ${sql.json(slots as never)}, ${slots.length}, ${a.gearTier ?? null})
    on conflict (guild_id, thread_id, user_id) do update set
      type = excluded.type, loot = excluded.loot, kind = excluded.kind, build_channel_id = excluded.build_channel_id,
      count = excluded.count, counts = null, slots = excluded.slots, step = excluded.step, gear_tier = excluded.gear_tier,
      role = null, weapon = null, duty = null, query = null, weapon_class = null, created_at = now()
    returning id`;
  return row!.id;
}

export async function getDraft(sql: Sql, id: string, now: Date): Promise<StoredDraft | null> {
  const [r] = await sql`
    select * from slot_draft where id = ${id} and created_at > ${new Date(now.getTime() - DRAFT_TTL_MS)}`;
  return r ? toDraft(r) : null;
}

export async function saveDraft(sql: Sql, id: string, d: GuidedDraft & { weaponClass: string | null }): Promise<void> {
  await sql`
    update slot_draft set count = ${d.count}, slots = ${sql.json(d.slots as never)}, step = ${d.step},
      role = ${d.role}, weapon = ${d.weapon}, duty = ${d.duty}, weapon_class = ${d.weaponClass}
    where id = ${id}`;
}

export async function deleteDraft(sql: Sql, id: string): Promise<void> {
  await sql`delete from slot_draft where id = ${id}`;
}

export async function purgeDrafts(sql: Sql, now: Date): Promise<number> {
  const rows = await sql`
    delete from slot_draft where created_at <= ${new Date(now.getTime() - DRAFT_TTL_MS)} returning id`;
  const retries = await sql`delete from form_retry where created_at <= ${new Date(now.getTime() - DRAFT_TTL_MS)} returning id`;
  return rows.length + retries.length;
}
