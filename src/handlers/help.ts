import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL } from "../discord/response.ts";

// `/content help` (owner request 2026-10-08): a private summary of what the bot does, every command and the Manage panel.
export const HELP_TEXT = [
  "# Mistcaller help",
  "Content rosters for your guild: sign up, wait, vote on loot and track attendance.",
  "",
  "### Everyone",
  "• **Join:** pick an open position in the menu on the roster. Picking another one moves you. If the position has no weapon, you can choose yours.",
  "• **Fill:** choose Fill if you can play any position. You hold a seat until the owner places you.",
  "• **Leave** takes you off the roster. **Waitlist:** when a role is full, join its waitlist and you are seated when a spot frees up.",
  "• **Split / Regear:** vote on the loot, while the vote is open.",
  "• `/content create` starts a roster in this channel or post: a first form (type, players, gear tier, loot), the slot cards or a preset, then the final form. If it has mistakes, press **Fix and retry**.",
  "• `/content list` shows live and upcoming content. `/content me` is your own private panel.",
  "• `/content stats` shows this server's numbers, only to you. `/content history` shows your own attendance.",
  "• `/content help` shows this message.",
  "",
  "### The content's owner",
  "Press **Manage** on the roster. Only you see its panel:",
  "• **Edit:** category, loot vote, build link, and the details form.",
  "• **Add player** puts any member in an open position; the post says who added them. **Remove player** takes someone off.",
  "• **Set duty** (Caller, Scout, Rat, Looter, Catcher). **Set weapon** gives a position without a weapon its weapon.",
  "• **Lock** or **Unlock** signups, **End** (automatic 4 hours after the start), **Cancel**.",
  "• **Attendance** opens the form. On a finished roster, Manage offers Attendance and **Reopen**.",
  "• **Ping players** sends each player a private reminder once, so late joiners can be pinged later.",
  "• `/content preset` lists, saves and deletes slot presets; pick one in the first create form.",
  "",
  "### Admins (an admin role or Manage Server)",
  "• Everything the owner can do, on any content, and `/content history` for any member. Saving and deleting presets.",
  "• `/content setup` chooses the admin roles and the Events Calendar channel.",
].join("\n");

export async function handleHelpCommand(_deps: Deps, _i: Interaction): Promise<InteractionResponse> {
  return { type: CHANNEL_MESSAGE, data: { content: HELP_TEXT, flags: EPHEMERAL, allowed_mentions: { parse: [] } } };
}
