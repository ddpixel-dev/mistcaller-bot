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
  "• **Fill:** choose Fill in the menu if you can play any position. The owner places you.",
  "• **Leave** takes you off the roster. **Waitlist:** when a role is full, join its waitlist and you are seated when a spot frees up.",
  "• **Split / Regear:** vote on the loot, while the vote is open.",
  "• `/content create` starts a roster in this channel or post.",
  "• `/content list` shows upcoming content. `/content me` is your own private panel.",
  "• `/content history` shows a member's attendance. `/content weapon` looks up a weapon. `/content help` shows this message.",
  "",
  "### The owner and admins",
  "• `/content edit` changes the event. `/content cancel` cancels it.",
  "• `/content lock` closes signups early, `/content unlock` reopens them.",
  "• `/content duty` gives a player a duty (Caller, Scout, Rat). `/content assign` (or the **Assign fill** button) places a fill player in an open position.",
  "• `/content end` ends the content once it has started (it ends by itself 4 hours after the start). Don't forget it.",
  "• `/content attendance` opens the attendance form. **Ping players** on the roster sends a private reminder, once.",
  "• `/content preset` saves and loads slot presets. `/content slot` fills a guided slot.",
  "",
  "### Server admins (Manage Server)",
  "• `/content setup` chooses the roles that can manage content.",
].join("\n");

export async function handleHelpCommand(_deps: Deps, _i: Interaction): Promise<InteractionResponse> {
  return { type: CHANNEL_MESSAGE, data: { content: HELP_TEXT, flags: EPHEMERAL, allowed_mentions: { parse: [] } } };
}
