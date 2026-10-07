import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, reply } from "../discord/response.ts";
import { leafOption } from "../discord/modal.ts";
import { WEAPONS } from "../data/weapons.ts";
import { SLOT_LABEL, searchWeapons, weaponIconUrl } from "../domain/weapons.ts";
import { escapeText } from "../render/roster.ts";

export async function handleWeaponCommand(_deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = leafOption(i, "name");
  const query = typeof raw === "string" ? raw.trim().slice(0, 50) : "";
  if (!query) return reply("Type part of a weapon name, for example `great axe`.");
  const matches = searchWeapons(WEAPONS, query, 10);
  const top = matches[0];
  if (!top) return reply(`No weapon matches "${escapeText(query)}".`);
  const others = matches.slice(1).map((w) => `• ${escapeText(w.name)} (${SLOT_LABEL[w.slot]})`);
  return {
    type: CHANNEL_MESSAGE,
    data: {
      flags: EPHEMERAL,
      allowed_mentions: { parse: [] },
      embeds: [{
        title: escapeText(top.name),
        description: [
          `**${SLOT_LABEL[top.slot]}** · icon from tier T${top.iconTier}`,
          `Use it in a slot line: \`Role - ${top.name}\``,
          ...(others.length ? ["", "Also matching:", ...others] : []),
        ].join("\n"),
        thumbnail: { url: weaponIconUrl(top, 128) },
      }],
    },
  };
}
