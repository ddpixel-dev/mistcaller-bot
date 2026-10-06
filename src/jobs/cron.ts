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

// Claims due rows by setting loot_result_posted_at up-front in one UPDATE ... RETURNING
// (rows locked with FOR UPDATE SKIP LOCKED, so overlapping runs never claim the same row).
// The claim is un-set if the edit or the thread message fails, so the next run retries.
export async function postVoteResults(deps: Deps): Promise<number> {
  const now = deps.now();
  const dueBefore = new Date(now.getTime() + VOTE_CUTOFF_MS);
  const claimed = await deps.sql`
    update content set loot_result_posted_at = ${now}
    where id in (
      select id from content
      where has_loot and status in ('open', 'locked')
        and starts_at <= ${dueBefore} and loot_result_posted_at is null
      for update skip locked)
    returning id, thread_id`;
  let marked = 0;
  for (const c of claimed) {
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
      try {
        await deps.sql`update content set loot_result_posted_at = null where id = ${c.id}`;
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
