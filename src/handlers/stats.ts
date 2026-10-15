import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, reply } from "../discord/response.ts";
import { getStats } from "../db/stats.ts";
import { renderStats } from "../render/stats.ts";

// "/content stats" (FR-044, owner decision 2026-10-15, replacing the statistics channel): anyone can ask, and the answer
// is a private message. It counts only the server the command is used in.
export async function handleStatsCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  if (!i.guild_id) return reply("Use this command inside the server.");
  const now = deps.now();
  const message = renderStats(await getStats(deps.sql, i.guild_id, now), now) as { flags: number; components: unknown[]; allowed_mentions: { parse: [] } };
  return { type: CHANNEL_MESSAGE, data: { ...message, flags: message.flags | EPHEMERAL } };
}
