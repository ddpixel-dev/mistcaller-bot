import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { getRosterView } from "../db/content.ts";
import { castVote } from "../db/vote.ts";
import { renderRosterMessage } from "../render/roster.ts";
import type { VoteChoice } from "../domain/vote.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = "That action is not valid. Please use the buttons on the latest roster message.";
const NOT_FOUND = "This content no longer exists.";

function parse(i: Interaction): { id: string; choice: VoteChoice } | null {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  if (typeof raw !== "string") return null;
  const parts = raw.split(":");
  if (parts.length !== 3 || parts[0] !== "vote" || !UUID.test(parts[1]!)) return null;
  const choice = parts[2];
  if (choice !== "split" && choice !== "regear") return null;
  return { id: parts[1]!, choice };
}

export async function handleVote(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const parsed = parse(i);
  const userId = i.member?.user?.id;
  const guildId = i.guild_id;
  if (!parsed || !userId || !guildId) return reply(INVALID);

  const before = await getRosterView(deps.sql, parsed.id, deps.now());
  if (!before || before.guildId !== guildId) return reply(NOT_FOUND);

  const result = await castVote(deps.sql, {
    contentId: parsed.id, userId, guildId, choice: parsed.choice, now: deps.now(),
  });
  if (result === "closed") return reply("Voting is closed for this content.");
  if (result === "not_signed") return reply("Only members who are signed up can vote.");
  if (result === "no_loot") return reply("This content has no loot vote.");
  if (result === "unavailable") return reply("This content is no longer open, so voting is not available.");
  if (result === "not_found") return reply(NOT_FOUND);

  const view = await getRosterView(deps.sql, parsed.id, deps.now());
  if (!view) return reply(NOT_FOUND);
  return { type: UPDATE_MESSAGE, data: renderRosterMessage(view) };
}
