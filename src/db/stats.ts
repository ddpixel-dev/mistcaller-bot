import type { Sql } from "./client.ts";
import type { ContentType } from "../domain/types.ts";

// FR-044: the numbers of `/content stats`. Cancelled content does not count as an event; waiting members are not
// participants; a member who left a roster is gone (leaving deletes the sign-up). Attendance is not used at all, so
// unknown attendance can never become a no-show (NFR-004).
export type Period = { created: number; finished: number; cancelled: number; participants: number; signups: number };
export type Stats = {
  all: Period;
  month: Period;
  byType: Record<ContentType, number>;
  byKind: { type: ContentType; kind: string; count: number }[];
  fillRate: number | null; // percent, finished content only
  busiestDay: { day: number; count: number } | null; // 0 = Sunday, UTC
  busiestHour: { hour: number; count: number } | null; // UTC
  topHosts: { userId: string; count: number }[];
  topPlayers: { userId: string; count: number }[];
};

const MONTH_MS = 30 * 24 * 3600000;

async function period(sql: Sql, guildId: string, since: Date | null): Promise<Period> {
  const from = since ?? new Date(0);
  const [c] = await sql`
    select count(*)::int as created, (count(*) filter (where status = 'done'))::int as finished,
      (count(*) filter (where status = 'cancelled'))::int as cancelled
    from content where guild_id = ${guildId} and created_at >= ${from}`;
  const [p] = await sql`
    select count(*)::int as signups, count(distinct su.user_id)::int as participants
    from signup su join content c on c.id = su.content_id
    where c.guild_id = ${guildId} and c.status <> 'cancelled' and su.status in ('signed', 'fill') and c.created_at >= ${from}`;
  return { created: c!.created, finished: c!.finished, cancelled: c!.cancelled, participants: p!.participants, signups: p!.signups };
}

export async function getStats(sql: Sql, guildId: string, now: Date): Promise<Stats> {
  // One round trip's worth of waiting: the answer to `/content stats` has 3 seconds.
  const [all, month, kinds, [fill], [day], [hour], hosts, players] = await Promise.all([
    period(sql, guildId, null),
    period(sql, guildId, new Date(now.getTime() - MONTH_MS)),
    sql`
      select type, kind, count(*)::int as count from content
      where guild_id = ${guildId} and status <> 'cancelled' group by type, kind order by count desc, type, kind`,
    sql`
      select round(avg(x.seated::numeric / x.total) * 100)::int as rate from (
        select (select count(*) from signup su where su.content_id = c.id and su.status = 'signed') as seated,
               (select count(*) from slot s where s.content_id = c.id) as total
        from content c where c.guild_id = ${guildId} and c.status = 'done') x
      where x.total > 0`,
    sql`
      select extract(dow from starts_at at time zone 'UTC')::int as day, count(*)::int as count from content
      where guild_id = ${guildId} and status <> 'cancelled' group by 1 order by count desc, day limit 1`,
    sql`
      select extract(hour from starts_at at time zone 'UTC')::int as hour, count(*)::int as count from content
      where guild_id = ${guildId} and status <> 'cancelled' group by 1 order by count desc, hour limit 1`,
    sql`
      select created_by as user_id, count(*)::int as count from content
      where guild_id = ${guildId} and status <> 'cancelled' and created_by is not null group by 1 order by count desc, user_id limit 5`,
    sql`
      select su.user_id, count(distinct su.content_id)::int as count
      from signup su join content c on c.id = su.content_id
      where c.guild_id = ${guildId} and c.status <> 'cancelled' and su.status in ('signed', 'fill')
      group by su.user_id order by count desc, su.user_id limit 10`,
  ]);
  const byType: Record<ContentType, number> = { pvp: 0, pve: 0, pvx: 0 };
  for (const k of kinds) byType[k.type as ContentType] += k.count as number;
  return {
    all, month, byType,
    byKind: kinds.map((k) => ({ type: k.type as ContentType, kind: k.kind as string, count: k.count as number })),
    fillRate: fill?.rate ?? null,
    busiestDay: day ? { day: day.day, count: day.count } : null,
    busiestHour: hour ? { hour: hour.hour, count: hour.count } : null,
    topHosts: hosts.map((h) => ({ userId: h.user_id as string, count: h.count as number })),
    topPlayers: players.map((p) => ({ userId: p.user_id as string, count: p.count as number })),
  };
}
