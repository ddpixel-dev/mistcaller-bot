import type { Sql } from "./client.ts";

export type GuildSettings = {
  guildId: string;
  officerRoleId: string | null;
  pvpForumId: string;
  pveForumId: string;
  dailyCap: number;
};

export async function getGuildSettings(sql: Sql, guildId: string): Promise<GuildSettings | null> {
  const rows = await sql`
    select guild_id, officer_role_id, pvp_forum_id, pve_forum_id, daily_cap
    from guild_settings where guild_id = ${guildId}`;
  const r = rows[0];
  if (!r) return null;
  return {
    guildId: r.guild_id,
    officerRoleId: r.officer_role_id,
    pvpForumId: r.pvp_forum_id,
    pveForumId: r.pve_forum_id,
    dailyCap: r.daily_cap,
  };
}
