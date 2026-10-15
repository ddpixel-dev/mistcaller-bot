import type { Sql } from "./client.ts";

// FR-038: signed-up players (seated or fill) the owner has not pinged yet, oldest first. The owner is never a target.
export async function pingTargets(sql: Sql, contentId: string, ownerId: string | null): Promise<string[]> {
  const rows = await sql`
    select su.user_id from signup su
    where su.content_id = ${contentId} and su.status in ('signed', 'fill') and su.user_id is distinct from ${ownerId}
      and not exists (select 1 from ping_log p where p.content_id = su.content_id and p.user_id = su.user_id)
    order by su.joined_at, su.user_id`;
  return rows.map((r) => r.user_id as string);
}

// Record the players before sending, so a double click cannot message anyone twice. Returns those this call claimed.
export async function claimPings(sql: Sql, contentId: string, userIds: string[], now: Date): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await sql`
    insert into ping_log (content_id, user_id, pinged_at)
    select ${contentId}, u, ${now} from unnest(${userIds}::text[]) as u
    on conflict do nothing returning user_id`;
  return rows.map((r) => r.user_id as string);
}

// A message that could not be delivered does not count: the player can be pinged again.
export async function releasePings(sql: Sql, contentId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await sql`delete from ping_log where content_id = ${contentId} and user_id = any(${userIds}::text[])`;
}
