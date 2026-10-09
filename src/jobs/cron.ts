import { timingSafeEqual } from "node:crypto";
import type { Deps } from "../discord/dispatch.ts";
import { DiscordApiError } from "../discord/rest.ts";
import { getRosterView } from "../db/content.ts";
import { purgeDrafts } from "../db/draft.ts";
import { pendingReports } from "../db/attendance.ts";
import { postReport } from "../handlers/attendance.ts";
import { escapeText, renderRosterMessage, voteLine } from "../render/roster.ts";
import { REMINDER_LEAD_MS, VOTE_CUTOFF_MS } from "../domain/vote.ts";

export function isAuthorized(header: string | null, secret: string): boolean {
  if (!header || secret === "") return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function logFailure(evt: string, contentId: string, e: unknown): void {
  console.error(
    JSON.stringify({
      evt,
      contentId,
      error: e instanceof Error ? e.name : "unknown",
      status: e instanceof DiscordApiError ? e.status : undefined,
    }),
  );
}

// Edits the roster message. A 404 (message deleted) is logged and treated as handled.
// Any other error propagates to the caller.
async function editRoster(deps: Deps, id: string): Promise<void> {
  const view = await getRosterView(deps.sql, id, deps.now());
  if (!view || !view.messageId) return;
  try {
    await deps.rest.editMessage(view.threadId, view.messageId, renderRosterMessage(view));
  } catch (e) {
    if (e instanceof DiscordApiError && e.status === 404) {
      logFailure("roster_edit_404", id, e);
      return;
    }
    throw e;
  }
}

// Content nobody ended is ended by the scheduler this long after its start, or after its last reopen if later (owner
// decisions 2026-10-08 and 2026-10-09). Submitting the attendance form does not end it, because somebody can join late;
// only `/content end` or this does.
export const AUTO_END_MS = 4 * 60 * 60 * 1000;

export async function endStale(deps: Deps): Promise<number> {
  const now = deps.now();
  const rows = await deps.sql`
    update content set status = 'done', ended_at = ${now}
    where status in ('open', 'locked') and greatest(starts_at, coalesce(reopened_at, starts_at)) <= ${new Date(now.getTime() - AUTO_END_MS)}
    returning id`;
  for (const r of rows) {
    try {
      await editRoster(deps, r.id);
    } catch (e) {
      // The content stays ended; the roster is refreshed the next time anything edits it.
      logFailure("end_edit_failed", r.id, e);
    }
  }
  return rows.length;
}

const MAX_RESULTS_PER_RUN = 25;

// Claims ONE due row at a time by setting loot_result_posted_at up-front in a single
// UPDATE ... RETURNING (row picked with FOR UPDATE SKIP LOCKED, so overlapping runs never
// claim the same row). A kill strands at most the one in-flight row. The claim is released
// only if it still carries this run's timestamp. A row that failed in this run is not
// re-claimed in the same run.
export async function postVoteResults(deps: Deps): Promise<number> {
  const now = deps.now();
  const dueBefore = new Date(now.getTime() + VOTE_CUTOFF_MS);
  const failed = new Set<string>();
  let marked = 0;
  for (let i = 0; i < MAX_RESULTS_PER_RUN; i++) {
    const [c] = await deps.sql`
      update content set loot_result_posted_at = ${now}
      where id in (
        select id from content
        where has_loot and status in ('open', 'locked')
          and starts_at <= ${dueBefore} and loot_result_posted_at is null
          and id <> all(${[...failed]}::uuid[])
        order by starts_at, id
        limit 1
        for update skip locked)
      returning id, thread_id`;
    if (!c) break;
    try {
      await editRoster(deps, c.id);
      const view = await getRosterView(deps.sql, c.id, now);
      if (!view) throw new Error("content vanished");
      await deps.rest.createMessage(c.thread_id, {
        content: voteLine(view),
        allowed_mentions: { parse: [] },
      });
      marked++;
    } catch (e) {
      logFailure("vote_result_failed", c.id, e);
      failed.add(c.id);
      try {
        await deps.sql`
          update content set loot_result_posted_at = null
          where id = ${c.id} and loot_result_posted_at = ${now}`;
      } catch (e2) {
        logFailure("vote_result_unclaim_failed", c.id, e2);
      }
    }
  }
  return marked;
}

const ATTENDANCE_DELAY_MS = 5 * 60 * 1000;

// FR-014: 5 minutes after the start the owner gets the attendance form in a private message, to open whenever they can.
// If the private message cannot be sent (closed DMs), a short note with the command goes in the content's post.
// Claim-first like the other jobs, so it is sent once and a failed send is retried.
export async function sendAttendanceDms(deps: Deps): Promise<number> {
  const now = deps.now();
  const due = new Date(now.getTime() - ATTENDANCE_DELAY_MS);
  const failed = new Set<string>();
  let sent = 0;
  for (let i = 0; i < 25; i++) {
    const [c] = await deps.sql`
      update content set attendance_dm_sent_at = ${now}
      where id in (
        select id from content
        where status in ('open', 'locked', 'done') and starts_at <= ${due}
          and attendance_dm_sent_at is null and attendance_submitted_at is null
          and exists (select 1 from signup where content_id = content.id and status in ('signed', 'fill'))
          and id <> all(${[...failed]}::uuid[])
        order by starts_at, id
        limit 1
        for update skip locked)
      returning id, thread_id, title, created_by`;
    if (!c) break;
    if (!c.created_by) continue;
    const title = escapeText(c.title);
    try {
      try {
        if (!deps.rest.createDm) throw new Error("no direct messages");
        const channel = await deps.rest.createDm(c.created_by);
        await deps.rest.createMessage(channel, {
          content: `📋 **${title}** has started. When you can, open the attendance form.`,
          components: [{ type: 1, components: [{ type: 2, style: 1, label: "Start attendance form", custom_id: `att:open:${c.id}` }] }],
          allowed_mentions: { parse: [] },
        });
      } catch {
        await deps.rest.createMessage(c.thread_id, {
          content: `📋 <@${c.created_by}> **${title}** has started. Open the attendance form with \`/content attendance\`.`,
          allowed_mentions: { users: [c.created_by] },
        });
      }
      sent++;
    } catch (e) {
      logFailure("attendance_dm_failed", c.id, e);
      failed.add(c.id);
      try {
        await deps.sql`update content set attendance_dm_sent_at = null where id = ${c.id} and attendance_dm_sent_at = ${now}`;
      } catch (e2) {
        logFailure("attendance_dm_unclaim_failed", c.id, e2);
      }
    }
  }
  return sent;
}

// A report whose post failed when the owner submitted is retried here.
export async function postPendingReports(deps: Deps): Promise<number> {
  let posted = 0;
  for (const id of await pendingReports(deps.sql)) if (await postReport(deps, id)) posted++;
  return posted;
}

const MAX_REMINDERS_PER_RUN = 25;

// FR-011: ping the signed-up players once, about 30 minutes before the start. Same claim-first pattern as the
// vote result: reminder_sent_at is set in one UPDATE ... RETURNING (FOR UPDATE SKIP LOCKED), and released only
// if this run's send fails, so overlapping runs never send twice and a failed send is retried next run.
export async function sendReminders(deps: Deps): Promise<number> {
  const now = deps.now();
  const dueBefore = new Date(now.getTime() + REMINDER_LEAD_MS);
  const failed = new Set<string>();
  let sent = 0;
  for (let i = 0; i < MAX_REMINDERS_PER_RUN; i++) {
    const [c] = await deps.sql`
      update content set reminder_sent_at = ${now}
      where id in (
        select id from content
        where status in ('open', 'locked') and starts_at > ${now} and starts_at <= ${dueBefore} and reminder_sent_at is null
          and id <> all(${[...failed]}::uuid[])
        order by starts_at, id
        limit 1
        for update skip locked)
      returning id, thread_id, title, starts_at`;
    if (!c) break;
    try {
      const rows = await deps.sql`
        select user_id from signup where content_id = ${c.id} and status in ('signed', 'fill') order by joined_at`;
      const users = rows.map((r) => r.user_id as string);
      if (users.length > 0) {
        const epoch = Math.floor(c.starts_at.getTime() / 1000);
        await deps.rest.createMessage(c.thread_id, {
          content: `⏰ **${escapeText(c.title)}** starts <t:${epoch}:R>.\n${users.map((u) => `<@${u}>`).join(" ")}`,
          allowed_mentions: { users },
        });
        sent++;
      }
    } catch (e) {
      logFailure("reminder_failed", c.id, e);
      failed.add(c.id);
      try {
        await deps.sql`update content set reminder_sent_at = null where id = ${c.id} and reminder_sent_at = ${now}`;
      } catch (e2) {
        logFailure("reminder_unclaim_failed", c.id, e2);
      }
    }
  }
  return sent;
}

// Automatic reminders are off by default (owner decision 2026-10-08): the scheduler ran only every few hours, so the
// 30-minute reminder came late. The owner uses the Ping button on the roster instead. Set AUTO_REMINDERS=on to enable.
export async function runJobs(
  deps: Deps,
  opts: { autoReminders?: boolean } = {},
): Promise<{ ended: number; resultsPosted: number; remindersSent: number; attendanceDms: number; reportsPosted: number; draftsPurged: number }> {
  const resultsPosted = await postVoteResults(deps);
  const remindersSent = opts.autoReminders ? await sendReminders(deps) : 0;
  const attendanceDms = await sendAttendanceDms(deps);
  const reportsPosted = await postPendingReports(deps);
  const ended = await endStale(deps);
  const draftsPurged = await purgeDrafts(deps.sql, deps.now());
  return { ended, resultsPosted, remindersSent, attendanceDms, reportsPosted, draftsPurged };
}
