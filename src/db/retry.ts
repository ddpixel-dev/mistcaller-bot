import type { Sql } from "./client.ts";
import { DRAFT_TTL_MS } from "./draft.ts";

export type RetryFields = Record<string, string>;
export type StoredRetry = { id: string; formId: string; fields: RetryFields };

// The text of a form that had mistakes, kept so "Fix and retry" can reopen it filled in. One row per member and post:
// a new failure replaces the old one.
export async function saveRetry(
  sql: Sql,
  a: { guildId: string; userId: string; threadId: string; formId: string; fields: RetryFields; now: Date },
): Promise<string> {
  const [r] = await sql`
    insert into form_retry (guild_id, user_id, thread_id, form_id, fields, created_at)
    values (${a.guildId}, ${a.userId}, ${a.threadId}, ${a.formId}, ${sql.json(a.fields)}, ${a.now})
    on conflict (guild_id, thread_id, user_id) do update set
      form_id = excluded.form_id, fields = excluded.fields, created_at = excluded.created_at
    returning id`;
  return r!.id as string;
}

// Only the member who made the mistakes can reopen the form, and only within the hour.
export async function getRetry(sql: Sql, id: string, guildId: string, userId: string, now: Date): Promise<StoredRetry | null> {
  const [r] = await sql`
    select id, form_id, fields from form_retry
    where id = ${id} and guild_id = ${guildId} and user_id = ${userId}
      and created_at > ${new Date(now.getTime() - DRAFT_TTL_MS)}`;
  return r ? { id: r.id, formId: r.form_id, fields: r.fields as RetryFields } : null;
}
