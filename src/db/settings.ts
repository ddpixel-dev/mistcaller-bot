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

export type SettingsPatch = {
  officerRoleId?: string;
  pvpForumId?: string;
  pveForumId?: string;
  dailyCap?: number;
};

// The first setup needs both forums. Later ones change only what is given.
export async function applySettings(
  sql: Sql,
  guildId: string,
  patch: SettingsPatch,
): Promise<{ result: "ok"; settings: GuildSettings } | { result: "needs_forums" } | { result: "same_forum" }> {
  return await sql.begin(async (tx) => {
    const [cur] = await tx`select * from guild_settings where guild_id = ${guildId} for update`;
    const pvp = patch.pvpForumId ?? cur?.pvp_forum_id;
    const pve = patch.pveForumId ?? cur?.pve_forum_id;
    if (!pvp || !pve) return { result: "needs_forums" as const };
    if (pvp === pve) return { result: "same_forum" as const };
    const officer = patch.officerRoleId ?? cur?.officer_role_id ?? null;
    const cap = patch.dailyCap ?? cur?.daily_cap ?? 5;
    await tx`
      insert into guild_settings (guild_id, officer_role_id, pvp_forum_id, pve_forum_id, daily_cap)
      values (${guildId}, ${officer}, ${pvp}, ${pve}, ${cap})
      on conflict (guild_id) do update set
        officer_role_id = excluded.officer_role_id, pvp_forum_id = excluded.pvp_forum_id,
        pve_forum_id = excluded.pve_forum_id, daily_cap = excluded.daily_cap`;
    return {
      result: "ok" as const,
      settings: { guildId, officerRoleId: officer, pvpForumId: pvp, pveForumId: pve, dailyCap: cap },
    };
  });
}
