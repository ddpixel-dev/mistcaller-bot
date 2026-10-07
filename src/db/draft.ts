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
  query: string | null;
};

const toDraft = (r: Record<string, any>): StoredDraft => ({
  id: r.id,
  guildId: r.guild_id,
  userId: r.user_id,
  threadId: r.thread_id,
  type: (r.type === "pve" ? "pve" : "pvp") as ContentType,
  loot: r.loot,
  kind: r.kind,
  count: r.count ?? null,
  slots: r.slots as SlotDef[],
  step: r.step ?? 0,
  role: r.role ?? null,
  weapon: r.weapon ?? null,
  duty: r.duty ?? null,
  query: r.query,
});

// One draft per member per post: starting again replaces the old one.
export async function startDraft(
  sql: Sql,
  a: { guildId: string; userId: string; threadId: string; type: ContentType; loot: boolean; kind: string },
): Promise<string> {
  const [row] = await sql`
    insert into slot_draft (guild_id, user_id, thread_id, type, loot, kind, slots)
    values (${a.guildId}, ${a.userId}, ${a.threadId}, ${a.type}, ${a.loot}, ${a.kind}, '[]'::jsonb)
    on conflict (guild_id, thread_id, user_id) do update set
      type = excluded.type, loot = excluded.loot, kind = excluded.kind, count = null, counts = null,
      slots = '[]'::jsonb, step = 0, role = null, weapon = null, duty = null, query = null, created_at = now()
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
    update slot_draft set count = ${d.count}, slots = ${sql.json(d.slots as never)}, step = ${d.step},
      role = ${d.role}, weapon = ${d.weapon}, duty = ${d.duty}, query = ${d.query}
    where id = ${id}`;
}

// The member's draft for this post, used by "/content slot".
export async function findDraft(
  sql: Sql,
  a: { guildId: string; threadId: string; userId: string },
  now: Date,
): Promise<StoredDraft | null> {
  const [r] = await sql`
    select * from slot_draft
    where guild_id = ${a.guildId} and thread_id = ${a.threadId} and user_id = ${a.userId}
      and created_at > ${new Date(now.getTime() - DRAFT_TTL_MS)}`;
  return r ? toDraft(r) : null;
}

export async function deleteDraft(sql: Sql, id: string): Promise<void> {
  await sql`delete from slot_draft where id = ${id}`;
}

export async function purgeDrafts(sql: Sql, now: Date): Promise<number> {
  const rows = await sql`
    delete from slot_draft where created_at <= ${new Date(now.getTime() - DRAFT_TTL_MS)} returning id`;
  return rows.length;
}
