import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL } from "../discord/response.ts";

// `/content help` (owner request 2026-10-08): a private summary of what the bot does, every command and the Manage panel.
export const HELP_TEXT = [
  "# Mistcaller help",
  "Rosters for your guild: sign up, wait, vote on loot, track who came.",
  "",
  "### Everyone",
  "• **Join:** pick an open position in the roster's menu; picking another moves you.",
  "• **Fill:** pick what you can play. You are seated at once (healers first) or when a spot frees.",
  "• **Leave** takes you off. **Waitlist:** join it when a role is full; it seats you when a spot frees.",
  "• **❓ Tentative:** maybe coming; you keep your place. Press again to undo.",
  "• **Split / Regear:** vote on the loot, while the vote is open.",
  "• **Plan Content** opens a creation card; **Blank template** is a quick event. **Schedule CTA** (admins, CTA roles): one or two parties, optional 💣 Bombers. Roles: Tank, DTank, Healer, Support, DPS.",
  "• `/content list` shows live and upcoming content. `/content me` is your own private panel.",
  "• `/content stats` shows this server's numbers (private). `/content history` shows your own attendance.",
  "• `/content help` shows this message.",
  "",
  "### The content's owner",
  "Press **Manage** on the roster. Only you see its panel:",
  "• **Edit:** category, loot vote, build link, and the details form.",
  "• **Assign player** puts any member in an open position. **Review applicants** (host-picked events) accepts applicants. **Remove player** takes someone off.",
  "• **Set duty** (Caller, Scout, Rat, Looter, Catcher, Party or Main Healer). **Set weapon** fills a missing weapon.",
  "• **Lock** or **Unlock** signups, **End** (automatic 4 hours after start), **Cancel**.",
  "• **Attendance** opens the form. A finished roster offers Attendance and **Reopen**.",
  "• **Ping players** sends each player one private reminder.",
  "• Pick a preset on the creation card to fill the slots. Admins save and delete presets with **Manage presets**.",
  "",
  "### Admins (an admin role or Manage Server)",
  "• Everything the owner can do on any content, and `/content history` for any member.",
  "• `/content setup` sets admin roles, channels, the forum per type (PvP, PvE, PvX, ZvZ), CTA roles. `cta-msg` pins a message in every new CTA.",
].join("\n");

export async function handleHelpCommand(_deps: Deps, _i: Interaction): Promise<InteractionResponse> {
  return { type: CHANNEL_MESSAGE, data: { content: HELP_TEXT, flags: EPHEMERAL, allowed_mentions: { parse: [] } } };
}
