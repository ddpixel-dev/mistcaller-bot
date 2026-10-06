import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { getRosterView } from "../db/content.ts";
import { claimSlot, leaveContent } from "../db/signup.ts";
import { renderRosterMessage } from "../render/roster.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = "That action is not valid. Please use the buttons on the latest roster message.";
const NOT_FOUND = "This content or position no longer exists.";

function contentId(i: Interaction, prefix: string): string | null {
  const id = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  if (typeof id !== "string") return null;
  const parts = id.split(":");
  if (parts.length !== 2 || parts[0] !== prefix || !UUID.test(parts[1]!)) return null;
  return parts[1]!;
}

async function refreshed(deps: Deps, id: string): Promise<InteractionResponse> {
  const view = await getRosterView(deps.sql, id, deps.now());
  if (!view) return reply(NOT_FOUND);
  return { type: UPDATE_MESSAGE, data: renderRosterMessage(view) };
}

export async function handleSignup(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const id = contentId(i, "signup");
  const userId = i.member?.user?.id;
  const guildId = i.guild_id;
  const values = (i.data as { values?: unknown } | undefined)?.values;
  if (!id || !userId || !guildId || !Array.isArray(values) || values.length !== 1) return reply(INVALID);
  const slotId = values[0];
  if (typeof slotId !== "string" || !UUID.test(slotId)) return reply(INVALID);

  const view = await getRosterView(deps.sql, id, deps.now());
  if (!view || view.guildId !== guildId) return reply(NOT_FOUND);

  const result = await claimSlot(deps.sql, { contentId: id, slotId, userId, guildId });
  if (result === "taken") return reply("That position is already taken. Pick another one.");
  if (result === "locked") return reply("Signups are locked for this content.");
  if (result === "not_found") return reply(NOT_FOUND);
  return await refreshed(deps, id);
}

export async function handleLeave(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const id = contentId(i, "leave");
  const userId = i.member?.user?.id;
  const guildId = i.guild_id;
  if (!id || !userId || !guildId) return reply(INVALID);

  const view = await getRosterView(deps.sql, id, deps.now());
  if (!view || view.guildId !== guildId) return reply(NOT_FOUND);

  const result = await leaveContent(deps.sql, { contentId: id, userId });
  if (result === "not_signed") return reply("You are not signed up for this content.");
  if (result === "unavailable") return reply("This content is no longer open, so you cannot leave it.");
  return await refreshed(deps, id);
}
