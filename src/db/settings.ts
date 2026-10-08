import type { Sql } from "./client.ts";

export const MAX_ADMIN_ROLES = 10;

// The roles whose members may manage any content and the presets (ADR 0020). Manage Server and Administrator
// always count as well; that is decided in the permission code, not stored.
export async function getAdminRoleIds(sql: Sql, guildId: string): Promise<string[]> {
  const rows = await sql`select role_id from guild_admin_role where guild_id = ${guildId} order by created_at, role_id`;
  return rows.map((r) => r.role_id as string);
}

// Replaces the whole set in one transaction, so two quick changes cannot interleave into a mixed set.
export async function setAdminRoles(sql: Sql, guildId: string, roleIds: string[]): Promise<void> {
  const ids = [...new Set(roleIds)];
  if (ids.length > MAX_ADMIN_ROLES) throw new Error("too many admin roles");
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${"admin_roles:" + guildId}))`;
    await tx`delete from guild_admin_role where guild_id = ${guildId} and not (role_id = any(${ids}))`;
    for (const roleId of ids) {
      await tx`insert into guild_admin_role (guild_id, role_id) values (${guildId}, ${roleId}) on conflict do nothing`;
    }
  });
}
