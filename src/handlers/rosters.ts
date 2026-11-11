import type { Deps } from "../discord/dispatch.ts";
import { DiscordApiError } from "../discord/rest.ts";
import { getPartyMessages } from "../db/content.ts";
import { renderRosterMessage } from "../render/roster.ts";
import type { RosterView } from "../domain/types.ts";

// Re-renders every party's roster message through the API, except party `opts.except` (whose message the caller
// answers itself). A failed edit is logged without message text and never stops the other parties.
// With `noRetry`, a rate limit is not waited out (the edit is best-effort and the roster heals on the next change).
// With `strict`, the first failure other than 404 (message deleted) is rethrown after every party was tried, for
// callers that retry or fall back on failure.
export async function refreshRosters(deps: Deps, view: RosterView, opts: { except?: number; strict?: boolean; noRetry?: boolean } = {}): Promise<void> {
  let failure: unknown;
  const messages = await getPartyMessages(deps.sql, view.id);
  for (const m of messages) {
    if (m.party === opts.except) continue;
    try {
      await deps.rest.editMessage(view.threadId, m.messageId, renderRosterMessage(view, m.party), opts.noRetry ? { retry429: false } : undefined);
    } catch (e) {
      console.error(JSON.stringify({
        evt: "roster_edit_failed", contentId: view.id, party: m.party, name: e instanceof Error ? e.name : "unknown",
        ...(e instanceof DiscordApiError ? { status: e.status, code: e.code } : {}),
      }));
      if (opts.strict && !(e instanceof DiscordApiError && e.status === 404)) failure ??= e;
    }
  }
  if (failure !== undefined) throw failure;
}
