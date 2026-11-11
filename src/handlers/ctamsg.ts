import type { Deps } from "../discord/dispatch.ts";
import { DiscordApiError } from "../discord/rest.ts";
import { getCtaMessage } from "../db/cta.ts";
import { forwardBody } from "../domain/ctamsg.ts";
import { pinQuietly } from "./pins.ts";

const GONE = "The CTA message was not added: the message or its channel no longer exists. Ask an admin to set it again with /content setup cta-msg.";
const CANNOT_OPEN = "The CTA message was not added: the bot cannot open it. Ask an admin to give the bot View Channel and Read Message History on that channel.";
const NOT_POSTED = "The CTA message was not added because of an error. Nothing was lost; the CTA is posted.";
const NOT_PINNED = "The CTA message was added but not pinned. Ask an admin to give the bot Pin Messages in the CTA channel.";

// Log like pin_failed: the event, the error name and the Discord status and code. Never any message text.
function logFailure(evt: string, e: unknown): void {
  console.error(JSON.stringify({ evt, name: e instanceof Error ? e.name : "unknown", ...(e instanceof DiscordApiError ? { status: e.status, code: e.code } : {}) }));
}

function forwardNote(e: unknown): string {
  if (e instanceof DiscordApiError) {
    if (e.status === 404 || e.code === 10008 || e.code === 10003) return GONE;
    if (e.status === 403 || e.code === 50001 || e.code === 50013) return CANNOT_OPEN;
  }
  return NOT_POSTED;
}

// FR-069: forwards the admin-configured CTA message into the CTA thread and pins the forward. Discord builds the
// snapshot, so the bot never reads the text. Never throws: every skipped step becomes a short note for the creator,
// and the CTA stands either way.
export async function postCtaMessage(deps: Deps, a: { guildId: string; threadId: string }): Promise<string[]> {
  try {
    const setting = await getCtaMessage(deps.sql, a.guildId);
    if (!setting) return [];
    let id: string;
    try {
      id = (await deps.rest.createMessage(a.threadId, forwardBody({ guildId: a.guildId, channelId: setting.channelId, messageId: setting.messageId }))).id;
    } catch (e) {
      logFailure("cta_message_post_failed", e);
      return [forwardNote(e)];
    }
    if (!deps.rest.pinMessage) return [NOT_PINNED];
    try {
      await pinQuietly(deps, a.threadId, id);
    } catch (e) {
      logFailure("cta_message_pin_failed", e);
      return [NOT_PINNED];
    }
    return [];
  } catch (e) {
    logFailure("cta_message_failed", e);
    return [NOT_POSTED];
  }
}
