import type { Sql } from "./client.ts";

export const MAX_CTA_ROLES = 10;

// FR-059: the forum where CTA (call to arms) posts are made, and the roles that may create them.
export async function getCtaForum(sql: Sql, guildId: string): Promise<string | null> {
  const [r] = await sql`select forum_id from cta_forum where guild_id = ${guildId}`;
  return r ? (r.forum_id as string) : null;
}

export async function setCtaForum(sql: Sql, guildId: string, forumId: string): Promise<void> {
  await sql`
    insert into cta_forum (guild_id, forum_id) values (${guildId}, ${forumId})
    on conflict (guild_id) do update set forum_id = excluded.forum_id, updated_at = now()`;
}

export async function clearCtaForum(sql: Sql, guildId: string): Promise<boolean> {
  return (await sql`delete from cta_forum where guild_id = ${guildId} returning guild_id`).length > 0;
}

export async function getCtaRoleIds(sql: Sql, guildId: string): Promise<string[]> {
  return (await sql`select role_id from guild_cta_role where guild_id = ${guildId} order by created_at, role_id`).map((r) => r.role_id as string);
}

// Replaces the whole set in one transaction, like the admin roles.
export async function setCtaRoles(sql: Sql, guildId: string, roleIds: string[]): Promise<void> {
  const ids = [...new Set(roleIds)];
  if (ids.length > MAX_CTA_ROLES) throw new Error("too many CTA roles");
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${"cta_roles:" + guildId}))`;
    await tx`delete from guild_cta_role where guild_id = ${guildId} and not (role_id = any(${ids}))`;
    for (const roleId of ids) await tx`insert into guild_cta_role (guild_id, role_id) values (${guildId}, ${roleId}) on conflict do nothing`;
  });
}
