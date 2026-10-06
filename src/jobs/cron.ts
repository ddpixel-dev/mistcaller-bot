import { timingSafeEqual } from "node:crypto";
import type { Deps } from "../discord/dispatch.ts";
import { DiscordApiError } from "../discord/rest.ts";
import { getRosterView } from "../db/content.ts";
import { renderRosterMessage, voteLine } from "../render/roster.ts";
import { VOTE_CUTOFF_MS } from "../domain/vote.ts";

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

export async function lockStarted(deps: Deps): Promise<number> {
  const now = deps.now();
  const rows = await deps.sql`
    update content set status = 'locked'
    where status = 'open' and starts_at <= ${now}
    returning id`;
  for (const r of rows) {
    try {
      await editRoster(deps, r.id);
    } catch (e) {
      // The lock stays; the next run does not re-edit (POC limitation).
      logFailure("lock_edit_failed", r.id, e);
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

export async function runJobs(deps: Deps): Promise<{ locked: number; resultsPosted: number }> {
  const resultsPosted = await postVoteResults(deps);
  const locked = await lockStarted(deps);
  return { locked, resultsPosted };
}
