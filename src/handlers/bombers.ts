import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { NOT_VALID, reply } from "../discord/response.ts";
import { getRosterView } from "../db/content.ts";
import { joinBombers } from "../db/signup.ts";
import { INVALID, NOT_FOUND, OLD_LAYOUT, SELECTED, isOldRoster, refreshed } from "./signup.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// FR-071: the 💣 Bombers button (bomb:<content>). The player is the verified user and the guild the verified guild;
// joining answers by updating the CTA message, like a seat, and a freed seat's promotion is announced.
export async function handleBombers(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  if (isOldRoster(i)) return reply(OLD_LAYOUT);
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const parts = typeof raw === "string" ? raw.split(":") : [];
  const userId = i.member?.user?.id;
  const guildId = i.guild_id;
  if (parts.length !== 2 || parts[0] !== "bomb" || !UUID.test(parts[1]!) || !userId || !guildId) return reply(INVALID);
  const id = parts[1]!;
  const { result, promoted } = await joinBombers(deps.sql, { contentId: id, guildId, userId, now: deps.now() });
  if (result === "already") return reply("You are in Bombers. Press Leave to leave.");
  if (result === "full") return reply("Bombers is full.");
  if (result === "off") return reply(NOT_VALID);
  if (result === "selected") return reply(SELECTED);
  if (result === "unavailable") {
    // As the seat paths: content of another guild or gone is not found; content that is not open is locked.
    const view = await getRosterView(deps.sql, id, deps.now());
    return reply(!view || view.guildId !== guildId ? NOT_FOUND : "Signups are locked for this content.");
  }
  return await refreshed(deps, i, id, 1, promoted);
}
