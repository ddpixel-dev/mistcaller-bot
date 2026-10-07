import type { Sql } from "./client.ts";
import { emptyDraft, type GuidedDraft } from "../domain/guided.ts";
import type { SlotDef } from "../domain/types.ts";

export const DRAFT_TTL_MS = 60 * 60 * 1000;

export type StoredDraft = GuidedDraft & {
  id: string;
  guildId: string;
  userId: string;
  threadId: string;
  loot: boolean;
  kind: string;
  query: string | null;
};

const toDraft = (r: Record<string, any>): StoredDraft => ({
  id: r.id,
  guildId: r.guild_id,
  userId: r.user_id,
  threadId: r.thread_id,
  loot: r.loot,
  kind: r.kind,
  count: r.count,
  slots: r.slots as SlotDef[],
  role: r.role,
  weapon: r.weapon,
  query: r.query,
});

// One draft per member per post: starting again replaces the old one.
export async function startDraft(
  sql: Sql,
  a: { guildId: string; userId: string; threadId: string; loot: boolean; kind: string },
): Promise<string> {
  const e = emptyDraft();
  const [row] = await sql`
    insert into slot_draft (guild_id, user_id, thread_id, loot, kind, slots)
    values (${a.guildId}, ${a.userId}, ${a.threadId}, ${a.loot}, ${a.kind}, ${sql.json(e.slots as never)})
    on conflict (guild_id, thread_id, user_id) do update set
      loot = excluded.loot, kind = excluded.kind, count = null, slots = excluded.slots,
      role = null, weapon = null, query = null, created_at = now()
    returning id`;
  return row!.id;
}

export async function getDraft(sql: Sql, id: string, now: Date): Promise<StoredDraft | null> {
  const [r] = await sql`
    select * from slot_draft where id = ${id} and created_at > ${new Date(now.getTime() - DRAFT_TTL_MS)}`;
  return r ? toDraft(r) : null;
}

export async function saveDraft(sql: Sql, id: string, d: GuidedDraft & { query: string | null }): Promise<void> {
  await sql`
    update slot_draft set count = ${d.count}, slots = ${sql.json(d.slots as never)},
      role = ${d.role}, weapon = ${d.weapon}, query = ${d.query}
    where id = ${id}`;
}

export async function deleteDraft(sql: Sql, id: string): Promise<void> {
  await sql`delete from slot_draft where id = ${id}`;
}

export async function purgeDrafts(sql: Sql, now: Date): Promise<number> {
  const rows = await sql`
    delete from slot_draft where created_at <= ${new Date(now.getTime() - DRAFT_TTL_MS)} returning id`;
  return rows.length;
}
