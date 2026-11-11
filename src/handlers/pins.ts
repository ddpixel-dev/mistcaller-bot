import type { Deps } from "../discord/dispatch.ts";
import { DiscordApiError } from "../discord/rest.ts";
import { findPinNotice } from "../domain/pins.ts";

// Pins a message, then deletes the "pinned a message" notice Discord posts (ADR 0047, FR-072).
// A pin failure is thrown as pinMessage threw it, so callers keep their own notes and logs. Returns false when the
// client cannot pin. The cleanup is best effort: one GET (last 5 messages), at most one DELETE, never thrown, never any message text logged.
export async function pinQuietly(deps: Deps, channelId: string, messageId: string): Promise<boolean> {
  if (!deps.rest.pinMessage) return false;
  await deps.rest.pinMessage(channelId, messageId);
  if (!deps.rest.listMessages) return true;
  try {
    const noticeId = findPinNotice(await deps.rest.listMessages(channelId, 5), messageId);
    if (noticeId) await deps.rest.deleteMessage(channelId, noticeId);
  } catch (e) {
    console.error(JSON.stringify({ evt: "pin_notice_delete_failed", name: e instanceof Error ? e.name : "unknown", ...(e instanceof DiscordApiError ? { status: e.status, code: e.code } : {}) }));
  }
  return true;
}
