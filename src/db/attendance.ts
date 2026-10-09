import type { Sql } from "./client.ts";

// A member without a position (a Fill) has no position, role or weapon.
export type Player = { userId: string; position: number | null; role: string; weapon: string; fill: boolean };
export type Attendance = {
  contentId: string;
  guildId: string;
  threadId: string;
  title: string;
  createdBy: string | null;
  status: string;
  startsAt: Date;
  submittedAt: Date | null;
  reportPostedAt: Date | null;
  players: Player[];
  marks: Record<string, "attended" | "no_show">;
};

export async function getAttendance(sql: Sql, contentId: string): Promise<Attendance | null> {
  const [c] = await sql`
    select id, guild_id, thread_id, title, created_by, status, starts_at, attendance_submitted_at, report_posted_at
    from content where id = ${contentId}`;
  if (!c) return null;
  const [players, marks] = await Promise.all([
    sql`select su.user_id, su.status, s.position, s.role, s.weapon, su.chosen_weapon
        from signup su left join slot s on s.id = su.slot_id
        where su.content_id = ${contentId} and su.status in ('signed', 'fill')
        order by s.position nulls last, su.joined_at, su.user_id`,
    sql`select user_id, status from attendance where content_id = ${contentId}`,
  ]);
  return {
    contentId: c.id, guildId: c.guild_id, threadId: c.thread_id, title: c.title, createdBy: c.created_by,
    status: c.status, startsAt: c.starts_at, submittedAt: c.attendance_submitted_at, reportPostedAt: c.report_posted_at,
    players: players.map((p) => ({ userId: p.user_id, position: p.position ?? null, role: p.role ?? "", weapon: p.weapon ?? p.chosen_weapon ?? "", fill: p.status === "fill" })),
    marks: Object.fromEntries(marks.map((m) => [m.user_id, m.status])) as Attendance["marks"],
  };
}

export type MarkResult = "ok" | "closed" | "not_found" | "invalid";

// "Attended" is exactly the picked players. Deselected ones go back to not recorded (never to no-show here).
export async function setAttended(
  sql: Sql,
  a: { contentId: string; userIds: string[]; markedBy: string; now: Date },
): Promise<MarkResult> {
  return await sql.begin(async (tx): Promise<MarkResult> => {
    const [c] = await tx`select guild_id, report_posted_at from content where id = ${a.contentId} for update`;
    if (!c) return "not_found";
    if (c.report_posted_at) return "closed";
    const signed = (await tx`select user_id from signup where content_id = ${a.contentId} and status in ('signed', 'fill')`).map((r) => r.user_id as string);
    if (a.userIds.some((u) => !signed.includes(u))) return "invalid";
    await tx`delete from attendance where content_id = ${a.contentId} and status = 'attended' and not (user_id = any(${a.userIds}::text[]))`;
    for (const u of a.userIds) {
      await tx`
        insert into attendance (guild_id, content_id, user_id, status, marked_by, marked_at)
        values (${c.guild_id}, ${a.contentId}, ${u}, 'attended', ${a.markedBy}, ${a.now})
        on conflict (content_id, user_id) do update set status = 'attended', marked_by = excluded.marked_by, marked_at = excluded.marked_at`;
    }
    return "ok";
  });
}

// Submit: everyone signed up who was not picked as attended is recorded as a no-show.
export async function submitAttendance(sql: Sql, a: { contentId: string; markedBy: string; now: Date }): Promise<MarkResult> {
  return await sql.begin(async (tx): Promise<MarkResult> => {
    const [c] = await tx`select guild_id, report_posted_at from content where id = ${a.contentId} for update`;
    if (!c) return "not_found";
    if (c.report_posted_at) return "closed";
    await tx`
      insert into attendance (guild_id, content_id, user_id, status, marked_by, marked_at)
      select ${c.guild_id}, ${a.contentId}, su.user_id, 'no_show', ${a.markedBy}, ${a.now}
      from signup su where su.content_id = ${a.contentId} and su.status in ('signed', 'fill')
      on conflict (content_id, user_id) do nothing`;
    await tx`update content set attendance_submitted_at = ${a.now} where id = ${a.contentId}`;
    return "ok";
  });
}

// The report is claimed before it is posted, so two submits or a retry never post it twice.
export async function claimReport(sql: Sql, contentId: string, now: Date): Promise<boolean> {
  const rows = await sql`
    update content set report_posted_at = ${now}
    where id = ${contentId} and attendance_submitted_at is not null and report_posted_at is null returning id`;
  return rows.length > 0;
}
export async function releaseReport(sql: Sql, contentId: string, now: Date): Promise<void> {
  await sql`update content set report_posted_at = null where id = ${contentId} and report_posted_at = ${now}`;
}

export async function pendingReports(sql: Sql): Promise<string[]> {
  return (await sql`select id from content where attendance_submitted_at is not null and report_posted_at is null limit 25`).map((r) => r.id as string);
}

// /content history: attended, no-shows, and finished contents where the member was signed up but never marked.
export async function memberHistory(sql: Sql, guildId: string, userId: string): Promise<{ attended: number; noShow: number; notRecorded: number }> {
  const [h] = await sql`
    select
      count(*) filter (where status = 'attended')::int as attended,
      count(*) filter (where status = 'no_show')::int as no_show
    from attendance where guild_id = ${guildId} and user_id = ${userId}`;
  const [n] = await sql`
    select count(*)::int as n from content c
    join signup su on su.content_id = c.id and su.user_id = ${userId} and su.status in ('signed', 'fill')
    where c.guild_id = ${guildId} and c.status = 'done'
      and not exists (select 1 from attendance a where a.content_id = c.id and a.user_id = ${userId})`;
  return { attended: h!.attended, noShow: h!.no_show, notRecorded: n!.n };
}

export type EndResult = "ok" | "not_started" | "unavailable";

// A manager ends content that has started: it becomes done.
export async function endContent(sql: Sql, contentId: string, now: Date): Promise<EndResult> {
  return await sql.begin(async (tx): Promise<EndResult> => {
    const [c] = await tx`select status, starts_at from content where id = ${contentId} for update`;
    if (!c || (c.status !== "open" && c.status !== "locked")) return "unavailable";
    if (c.starts_at > now) return "not_started";
    await tx`update content set status = 'done', ended_at = ${now} where id = ${contentId}`;
    return "ok";
  });
}

export type ReopenResult = "ok" | "not_ended";

// A manager reopens ended content (ended by hand or by the 4-hour rule): it is open again with a fresh auto-end
// window counted from now. The attendance report and the owner's DM are one-time actions and are not touched.
// The one-content-per-post index still holds the post for a done content, so nothing can have taken its place.
export async function reopenContent(sql: Sql, contentId: string, now: Date): Promise<ReopenResult> {
  return await sql.begin(async (tx): Promise<ReopenResult> => {
    const [c] = await tx`select status from content where id = ${contentId} for update`;
    if (!c || c.status !== "done") return "not_ended";
    await tx`update content set status = 'open', ended_at = null, reopened_at = ${now} where id = ${contentId}`;
    return "ok";
  });
}
