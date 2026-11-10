import type { Deps } from "../discord/dispatch.ts";
import { DiscordApiError } from "../discord/rest.ts";
import { getCtaMessage } from "../db/cta.ts";
import { buildCtaCopy } from "../domain/ctamsg.ts";

const NOT_READ = "The CTA message was not added: the bot cannot read it. Check View Channel and Read Message History.";
const GONE = "The CTA message was not added: the source message no longer exists. An admin should set it again with /content setup cta-msg.";
const EMPTY = "The CTA message was not added: it has nothing the bot can copy (text, embeds or attachments).";
const NOT_POSTED = "The CTA message was not added: the bot could not post it in the thread.";
const NOT_PINNED = "The CTA message was posted but not pinned. Give the bot Manage Messages (or Pin Messages) in the thread.";

// Log like pin_failed: the event, the error name and the Discord status and code. Never any message text.
function logFailure(evt: string, e: unknown): void {
  console.error(JSON.stringify({ evt, name: e instanceof Error ? e.name : "unknown", ...(e instanceof DiscordApiError ? { status: e.status, code: e.code } : {}) }));
}

// FR-069: copies the admin-configured CTA message into the CTA thread and pins it. Never throws: every skipped step
// becomes a short note for the creator, and the CTA stands either way.
export async function postCtaMessage(deps: Deps, a: { guildId: string; threadId: string }): Promise<string[]> {
  try {
    const setting = await getCtaMessage(deps.sql, a.guildId);
    if (!setting) return [];
    if (!deps.rest.getMessage) return [NOT_READ];
    const src = await deps.rest.getMessage(setting.channelId, setting.messageId).catch((e) => { logFailure("cta_message_read_failed", e); return null; });
    if (!src) return [NOT_READ];
    if (!src.ok) return [src.reason === "missing" ? GONE : NOT_READ];
    const copy = buildCtaCopy(src.message);
    if (!copy) return [EMPTY];
    let id: string;
    try {
      id = (await deps.rest.createMessage(a.threadId, copy)).id;
    } catch (e) {
      logFailure("cta_message_post_failed", e);
      return [NOT_POSTED];
    }
    try {
      await deps.rest.pinMessage?.(a.threadId, id);
    } catch (e) {
      logFailure("cta_message_pin_failed", e);
      return [NOT_PINNED];
    }
    return [];
  } catch (e) {
    logFailure("cta_message_failed", e);
    return ["The CTA message was not added because of an error. Nothing was lost; the CTA is posted."];
  }
}
