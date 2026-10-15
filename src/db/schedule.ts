import type { Sql } from "./client.ts";
import type { ContentType } from "../domain/types.ts";
import { seatCounts } from "../domain/seats.ts";
import type { ScheduleEvent } from "../render/schedule.ts";

const WEEK_MS = 7 * 24 * 3600000;

// FR-043: the server's live and upcoming events: open or locked, started or starting within 7 days, soonest first.
// The party count is the same as the roster's (seated players plus reserved fills, FR-040).
export async function listSchedule(sql: Sql, guildId: string, now: Date): Promise<ScheduleEvent[]> {
  const rows = await sql`
    select c.id, c.thread_id, c.message_id, c.title, c.type, c.kind, c.starts_at, c.status,
      (select count(*)::int from slot s where s.content_id = c.id) as total,
      (select count(*)::int from signup su where su.content_id = c.id and su.status = 'signed') as seated,
      (select count(*)::int from signup su where su.content_id = c.id and su.status = 'fill') as fills
    from content c
    where c.guild_id = ${guildId} and c.status in ('open', 'locked') and c.starts_at <= ${new Date(now.getTime() + WEEK_MS)}
    order by c.starts_at, c.id`;
  return rows.map((r) => ({
    id: r.id, threadId: r.thread_id, messageId: r.message_id, title: r.title, type: r.type as ContentType, kind: r.kind,
    startsAt: r.starts_at, status: r.status, total: r.total, party: seatCounts(r.total, r.seated, r.fills).party,
  }));
}
