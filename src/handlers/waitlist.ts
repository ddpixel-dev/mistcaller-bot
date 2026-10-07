import type { Deps } from "../discord/dispatch.ts";
import type { Promotion } from "../db/signup.ts";
import { escapeText } from "../render/roster.ts";

// Tell the members who were just seated from the waitlist. One message in the content's post, pinging only them.
export async function announcePromotions(deps: Deps, threadId: string, title: string, promoted: Promotion[]): Promise<void> {
  if (promoted.length === 0) return;
  const lines = promoted.map((p) => `<@${p.userId}> a position opened for you: **${p.position}. ${escapeText(p.role)} - ${escapeText(p.weapon)}**`);
  try {
    await deps.rest.createMessage(threadId, {
      content: `🕒 **${escapeText(title)}**\n${lines.join("\n")}`,
      allowed_mentions: { users: promoted.map((p) => p.userId) },
    });
  } catch (err) {
    console.error(JSON.stringify({ evt: "promotion_announce_failed", name: err instanceof Error ? err.name : "unknown" }));
  }
}
