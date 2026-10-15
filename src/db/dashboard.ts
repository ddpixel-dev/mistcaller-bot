import type { Sql } from "./client.ts";

export type DashboardKind = "schedule" | "statistics";
export type Dashboard = { guildId: string; kind: DashboardKind; channelId: string; messageIds: string[]; digest: string; updatedAt: Date };

const row = (r: Record<string, any>): Dashboard => ({
  guildId: r.guild_id, kind: r.kind, channelId: r.channel_id, messageIds: (r.message_ids as string[]) ?? [], digest: r.digest, updatedAt: r.updated_at,
});

export async function getDashboard(sql: Sql, guildId: string, kind: DashboardKind): Promise<Dashboard | null> {
  const [r] = await sql`select * from dashboard where guild_id = ${guildId} and kind = ${kind}`;
  return r ? row(r) : null;
}

export async function listDashboards(sql: Sql, kind: DashboardKind): Promise<Dashboard[]> {
  return (await sql`select * from dashboard where kind = ${kind} order by guild_id`).map(row);
}

// Set the channel: a different channel starts with no messages (the caller removes the old ones first).
export async function setDashboardChannel(sql: Sql, a: { guildId: string; kind: DashboardKind; channelId: string; now: Date }): Promise<void> {
  await sql`
    insert into dashboard (guild_id, kind, channel_id, message_ids, digest, updated_at)
    values (${a.guildId}, ${a.kind}, ${a.channelId}, '[]'::jsonb, '', ${a.now})
    on conflict (guild_id, kind) do update set channel_id = excluded.channel_id, message_ids = '[]'::jsonb, digest = '', updated_at = excluded.updated_at`;
}

export async function saveDashboardState(sql: Sql, a: { guildId: string; kind: DashboardKind; messageIds: string[]; digest: string; now: Date }): Promise<void> {
  await sql`
    update dashboard set message_ids = ${sql.json(a.messageIds)}, digest = ${a.digest}, updated_at = ${a.now}
    where guild_id = ${a.guildId} and kind = ${a.kind}`;
}

export async function deleteDashboard(sql: Sql, guildId: string, kind: DashboardKind): Promise<void> {
  await sql`delete from dashboard where guild_id = ${guildId} and kind = ${kind}`;
}
