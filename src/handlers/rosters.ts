import type { Deps } from "../discord/dispatch.ts";
import { DiscordApiError } from "../discord/rest.ts";
import { deleteContentMessage, getPartyMessages } from "../db/content.ts";
import { renderMovedNote, renderRosterMessage } from "../render/roster.ts";
import type { RosterView } from "../domain/types.ts";

// A call to arms is one message holding every party (ADR 0047); a blank one has no parties.
export const isOneMessage = (view: RosterView): boolean => view.cta === true && !view.blank;

const log = (view: RosterView, party: number, e: unknown) => console.error(JSON.stringify({
  evt: "roster_edit_failed", contentId: view.id, party, name: e instanceof Error ? e.name : "unknown",
  ...(e instanceof DiscordApiError ? { status: e.status, code: e.code } : {}),
}));
const isGone = (e: unknown) => e instanceof DiscordApiError && e.status === 404;

// Re-renders every party's roster message through the API, except party `opts.except` (whose message the caller
// answers itself). The roster is in its own channel for a call to arms (rosterChannelId), in the thread otherwise.
// A 0.31.8 call to arms still has a party 2 message: it is edited once into the moved note and its row is deleted, so
// it is not edited again (ADR 0047). With `except` on it, the caller answers it with the note, so only the row goes.
// A failed edit is logged without message text and never stops the other parties.
// With `noRetry`, a rate limit is not waited out (the edit is best-effort and the roster heals on the next change).
// With `strict`, the first failure other than 404 (message deleted) is rethrown after every party was tried, for
// callers that retry or fall back on failure.
export async function refreshRosters(deps: Deps, view: RosterView, opts: { except?: number; strict?: boolean; noRetry?: boolean } = {}): Promise<void> {
  let failure: unknown;
  const channel = view.rosterChannelId ?? view.threadId;
  const one = isOneMessage(view);
  const messages = await getPartyMessages(deps.sql, view.id);
  for (const m of messages) {
    const moved = one && m.party > 1;
    try {
      if (m.party !== opts.except) {
        try {
          await deps.rest.editMessage(channel, m.messageId, moved ? renderMovedNote() : renderRosterMessage(view, m.party), opts.noRetry ? { retry429: false } : undefined);
        } catch (e) {
          // A deleted note message is forgotten like an edited one.
          if (!(moved && isGone(e))) throw e;
        }
      } else if (!moved) continue;
      if (moved) await deleteContentMessage(deps.sql, view.id, m.party);
    } catch (e) {
      log(view, m.party, e);
      if (opts.strict && !isGone(e)) failure ??= e;
    }
  }
  if (failure !== undefined) throw failure;
}
