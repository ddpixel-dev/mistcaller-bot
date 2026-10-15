import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { reply } from "../discord/response.ts";
import { getAttendance } from "../db/attendance.ts";
import { claimPings, pingTargets, releasePings } from "../db/ping.ts";
import { getRosterView } from "../db/content.ts";
import { escapeText, renderRosterMessage } from "../render/roster.ts";
import { OLD_LAYOUT, isOldRoster } from "./signup.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The Ping players button (owner decisions 2026-10-08 and 2026-10-15): only the content's creator can use it. It sends a
// private message to each signed-up player who has not been pinged yet, so late joiners can be pinged later and nobody
// is pinged twice. The owner gets a copy and is told who could not be reached.
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
  if (!deps.rest.createDm) return reply("Private messages are not available right now.");

  // Claim the players before sending, so a double click cannot message anyone twice.
  const now = deps.now();
  const targets = await claimPings(deps.sql, id, await pingTargets(deps.sql, id, userId), now);
  if (targets.length === 0) return reply("Nobody is left to ping: every signed-up player was already pinged. Players who join later can be pinged with this button again.");

  const view = await getRosterView(deps.sql, id, now);
  const epoch = Math.floor(a.startsAt.getTime() / 1000);
  const link = view?.messageId ? `https://discord.com/channels/${a.guildId}/${a.threadId}/${view.messageId}` : `https://discord.com/channels/${a.guildId}/${a.threadId}`;
  const message = `⏰ **${escapeText(a.title)}** starts <t:${epoch}:R> (<t:${epoch}:f>).\n${link}\nFrom the owner, <@${userId}>.`;
  const body = { content: message, allowed_mentions: { parse: [] } };
  const copy = { content: `📋 Your copy. This is what your players get:\n\n${message}`, allowed_mentions: { parse: [] } };
  const sendTo = async (u: string, b: typeof body) => {
    const channel = await deps.rest.createDm!(u);
    await deps.rest.createMessage(channel, b);
  };

  // In parallel: every interaction must be answered within 3 seconds. The owner's copy never counts as a player.
  const [results, ownerCopy] = await Promise.all([
    Promise.allSettled(targets.map((u) => sendTo(u, body))),
    Promise.allSettled([sendTo(userId, copy)]),
  ]);
  const failed = targets.filter((_, n) => results[n]!.status === "rejected");
  const sent = targets.length - failed.length;
  // A player who could not be reached does not count as pinged, so the next press tries again.
  await releasePings(deps.sql, id, failed);
  if (sent === 0) return reply(`📣 Nobody could be reached (their private messages are closed). Tell them in the post.`);
  // Dim the button when nobody is left to ping.
  try {
    const fresh = await getRosterView(deps.sql, id, deps.now());
    if (fresh?.messageId) await deps.rest.editMessage(fresh.threadId, fresh.messageId, renderRosterMessage(fresh));
  } catch (err) {
    console.error(JSON.stringify({ evt: "roster_refresh_failed", name: err instanceof Error ? err.name : "unknown" }));
  }
  const lines = [`📣 Sent to ${sent} of ${targets.length} player${targets.length === 1 ? "" : "s"}${ownerCopy[0]!.status === "fulfilled" ? ", and a copy to you" : ""}.`];
  if (failed.length) lines.push(`Could not reach: ${failed.map((u) => `<@${u}>`).join(" ")} (their private messages are closed). Tell them in the post.`);
  lines.push("Players who join later can be pinged with this button again.");
  return reply(lines.join("\n"));
}
