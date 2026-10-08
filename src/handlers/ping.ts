import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { reply } from "../discord/response.ts";
import { getAttendance } from "../db/attendance.ts";
import { getRosterView } from "../db/content.ts";
import { escapeText, renderRosterMessage } from "../render/roster.ts";
import { OLD_LAYOUT, isOldRoster } from "./signup.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The Ping players button (owner decision 2026-10-08, instead of the automatic reminder): only the content's creator
// can use it. It sends a private message to every signed-up player and tells the owner who could not be reached.
export async function handlePing(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  if (isOldRoster(i)) return reply(OLD_LAYOUT);
  const [prefix, id, extra] = ((i.data as { custom_id?: unknown } | undefined)?.custom_id as string | undefined)?.split(":") ?? [];
  const userId = i.member?.user?.id;
  if (prefix !== "ping" || extra !== undefined || !id || !UUID.test(id) || !userId || !i.guild_id) {
    return reply("That action is not valid. Please use the buttons on the latest roster message.");
  }
  const a = await getAttendance(deps.sql, id);
  if (!a || a.guildId !== i.guild_id) return reply("This content no longer exists.");
  if (a.createdBy !== userId) return reply("Only the owner of this content can ping the players.");
  if (a.status !== "open" && a.status !== "locked") return reply("This content is finished or cancelled, so there is nobody to ping.");
  const view = await getRosterView(deps.sql, id, deps.now());
  if (view?.pinged) return reply("You already pinged the players for this content. It can be done once.");
  const targets = a.players.map((p) => p.userId).filter((u) => u !== userId);
  if (targets.length === 0) return reply("Nobody else is signed up yet.");
  if (!deps.rest.createDm) return reply("Private messages are not available right now.");

  // Once per content: claim it before sending so a double click cannot send twice.
  const now = deps.now();
  const claimed = await deps.sql`update content set pinged_at = ${now} where id = ${id} and pinged_at is null returning id`;
  if (claimed.length === 0) return reply("You already pinged the players for this content. It can be done once.");

  const epoch = Math.floor(a.startsAt.getTime() / 1000);
  const link = view?.messageId ? `https://discord.com/channels/${a.guildId}/${a.threadId}/${view.messageId}` : `https://discord.com/channels/${a.guildId}/${a.threadId}`;
  const body = {
    content: `⏰ **${escapeText(a.title)}** starts <t:${epoch}:R> (<t:${epoch}:f>).\n${link}\nFrom the owner, <@${userId}>.`,
    allowed_mentions: { parse: [] },
  };
  // In parallel: every interaction must be answered within 3 seconds.
  const results = await Promise.allSettled(targets.map(async (u) => {
    const channel = await deps.rest.createDm!(u);
    await deps.rest.createMessage(channel, body);
  }));
  const failed = targets.filter((_, n) => results[n]!.status === "rejected");
  const sent = targets.length - failed.length;
  if (sent === 0) {
    // Nobody was reached, so the owner keeps the ping.
    await deps.sql`update content set pinged_at = null where id = ${id} and pinged_at = ${now}`;
    return reply(`📣 Nobody could be reached (their private messages are closed). The ping is not used up. Tell them in the post.`);
  }
  // Dim the button so it is clearly used.
  try {
    const fresh = await getRosterView(deps.sql, id, deps.now());
    if (fresh?.messageId) await deps.rest.editMessage(fresh.threadId, fresh.messageId, renderRosterMessage(fresh));
  } catch (err) {
    console.error(JSON.stringify({ evt: "roster_refresh_failed", name: err instanceof Error ? err.name : "unknown" }));
  }
  const lines = [`📣 Sent to ${sent} of ${targets.length} players.`];
  if (failed.length) lines.push(`Could not reach: ${failed.map((u) => `<@${u}>`).join(" ")} (their private messages are closed). Tell them in the post.`);
  lines.push("The Ping button is now used.");
  return reply(lines.join("\n"));
}
