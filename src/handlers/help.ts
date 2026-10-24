import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL } from "../discord/response.ts";

// `/content help` (owner request 2026-10-08): a private summary of what the bot does and every command.
export const HELP_TEXT = [
  "# Mistcaller help",
  "Content rosters for your guild: sign up, wait, vote on loot and track attendance.",
  "",
  "### Everyone",
  "• **Join:** pick an open position in the menu on the roster. Picking another one moves you. If the position has no weapon, you can choose yours.",
  "• **Fill:** choose Fill if you can play any position. You hold a seat until the owner places you.",
  "• **Leave** takes you off the roster. **Waitlist:** when a role is full, join its waitlist and you are seated when a spot frees up.",
  "• **Split / Regear:** vote on the loot, while the vote is open.",
  "• `/content create` starts a roster in this channel or post. If the form has mistakes, press **Fix and retry**.",
  "• `/content list` shows live and upcoming content. `/content me` is your own private panel.",
  "• `/content stats` shows this server's numbers, only to you. `/content history` shows your own attendance.",
  "• `/content weapon` looks up a weapon. `/content help` shows this message.",
  "",
  "### The content's owner",
  "• **Manage** on the roster opens your private panel: edit, sign up or remove players, duties, lock, end, cancel, attendance.",
  "• Or use `/content edit`, `/content cancel`, `/content lock` and `/content unlock`.",
  "• `/content duty` sets a duty (Caller, Scout, Rat, Looter, Catcher). `/content assign` signs up any member in an open position.",
  "• `/content end` ends the content (it ends by itself 4 hours after the start). `/content reopen` brings it back.",
  "• `/content attendance` opens the attendance form. **Ping players** sends a private reminder to each player once, so late joiners can be pinged later.",
  "• `/content preset` loads slot presets. `/content slot` fills a guided slot.",
  "",
  "### Admins (an admin role or Manage Server)",
  "• Everything the owner can do, on any content, and `/content history` for any member. Saving and deleting presets.",
  "• `/content setup` chooses the admin roles and the Events Calendar channel.",
].join("\n");

export async function handleHelpCommand(_deps: Deps, _i: Interaction): Promise<InteractionResponse> {
  return { type: CHANNEL_MESSAGE, data: { content: HELP_TEXT, flags: EPHEMERAL, allowed_mentions: { parse: [] } } };
}
