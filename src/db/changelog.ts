import type { Sql } from "./client.ts";

// FR-061: the channel where a server wants each release's changelog, and which versions were already posted there.
export async function getChangelogChannel(sql: Sql, guildId: string): Promise<string | null> {
  const [r] = await sql`select channel_id from changelog_channel where guild_id = ${guildId}`;
  return r ? (r.channel_id as string) : null;
}

export async function setChangelogChannel(sql: Sql, guildId: string, channelId: string): Promise<void> {
  await sql`
    insert into changelog_channel (guild_id, channel_id) values (${guildId}, ${channelId})
    on conflict (guild_id) do update set channel_id = excluded.channel_id, updated_at = now()`;
}

export async function clearChangelogChannel(sql: Sql, guildId: string): Promise<boolean> {
  const rows = await sql`delete from changelog_channel where guild_id = ${guildId} returning guild_id`;
  return rows.length > 0;
}

// The servers that have a channel and have not been sent this version.
export async function pendingChangelogTargets(sql: Sql, version: string): Promise<{ guildId: string; channelId: string }[]> {
  const rows = await sql`
    select c.guild_id, c.channel_id from changelog_channel c
    where not exists (select 1 from changelog_post p where p.guild_id = c.guild_id and p.version = ${version})
    order by c.guild_id`;
  return rows.map((r) => ({ guildId: r.guild_id as string, channelId: r.channel_id as string }));
}

// True when this call recorded it, false when the version was already recorded for the server.
export async function markChangelogPosted(sql: Sql, guildId: string, version: string, now: Date): Promise<boolean> {
  const rows = await sql`
    insert into changelog_post (guild_id, version, posted_at) values (${guildId}, ${version}, ${now})
    on conflict do nothing returning guild_id`;
  return rows.length > 0;
}
