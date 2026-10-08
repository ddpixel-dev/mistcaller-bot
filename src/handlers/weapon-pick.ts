import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { WEAPONS } from "../data/weapons.ts";
import { SLOT_LABEL, WEAPON_CLASSES, isWeaponClass, weaponsOfClass, type WeaponClass } from "../domain/weapons.ts";
import { chooseWeapon } from "../db/signup.ts";
import { getRosterView } from "../db/content.ts";
import { escapeText, renderRosterMessage } from "../render/roster.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = "That panel is out of date. Pick your position again, or use `/content me`.";

// FR-030: the private picker a player gets after joining a slot that has no weapon. Weapon class, then weapon.
export function weaponPicker(contentId: string, cls: WeaponClass | null, intro: string) {
  const rows: unknown[] = [{
    type: 1,
    components: [{
      type: 3, custom_id: `wp:c:${contentId}`, placeholder: "Weapon class",
      options: WEAPON_CLASSES.filter((c) => c !== "Other").map((c) => ({ label: c, value: c, default: c === cls })),
    }],
  }];
  const list = cls ? weaponsOfClass(WEAPONS, cls).slice(0, 25) : [];
  if (cls && list.length > 0) {
    rows.push({
      type: 1,
      components: [{
        type: 3, custom_id: `wp:w:${contentId}:${cls}`, placeholder: "Your weapon",
        options: list.map((w) => ({ label: `${w.name} (${SLOT_LABEL[w.slot]})`.slice(0, 100), value: w.base })),
      }],
    });
  }
  rows.push({ type: 1, components: [{ type: 2, style: 2, label: "Skip", custom_id: `wp:skip:${contentId}` }] });
  return { content: intro, components: rows, allowed_mentions: { parse: [] as [] } };
}

export const pickerResponse = (contentId: string, intro: string): InteractionResponse => ({
  type: CHANNEL_MESSAGE, data: { ...weaponPicker(contentId, null, intro), flags: EPHEMERAL },
});

async function refreshRoster(deps: Deps, id: string): Promise<void> {
  try {
    const view = await getRosterView(deps.sql, id, deps.now());
    if (view?.messageId) await deps.rest.editMessage(view.threadId, view.messageId, renderRosterMessage(view));
  } catch (err) {
    console.error(JSON.stringify({ evt: "roster_refresh_failed", name: err instanceof Error ? err.name : "unknown" }));
  }
}

// wp:c:<content> (class chosen), wp:w:<content>:<class> (weapon chosen), wp:skip:<content>, wp:open:<content> (from /content me)
export async function handleWeaponPick(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = i.data as { custom_id?: unknown; values?: unknown } | undefined;
  const [prefix, action, id, cls, extra] = typeof data?.custom_id === "string" ? data.custom_id.split(":") : [];
  const userId = i.member?.user?.id;
  if (prefix !== "wp" || !id || !UUID.test(id) || extra !== undefined || !userId || !i.guild_id) return reply(INVALID);
  const values = Array.isArray(data?.values) ? data!.values : [];
  const intro = "Which weapon will you bring? This is optional.";

  if (action === "open") return pickerResponse(id, intro);
  if (action === "skip") {
    return { type: UPDATE_MESSAGE, data: { content: "Okay. You can pick a weapon later with `/content me`.", components: [], allowed_mentions: { parse: [] } } };
  }
  if (action === "c") {
    const chosen = values[0];
    if (values.length !== 1 || !isWeaponClass(chosen)) return reply(INVALID);
    return { type: UPDATE_MESSAGE, data: weaponPicker(id, chosen, intro) };
  }
  if (action === "w") {
    const base = values[0];
    const weapon = typeof base === "string" ? WEAPONS.find((w) => w.base === base) : undefined;
    if (values.length !== 1 || !weapon || !isWeaponClass(cls) || !weaponsOfClass(WEAPONS, cls).some((w) => w.base === weapon.base)) return reply(INVALID);
    const result = await chooseWeapon(deps.sql, { contentId: id, guildId: i.guild_id, userId, weapon: weapon.name });
    if (result === "not_signed") return reply("You are not on a position without a weapon, so there is nothing to choose.");
    if (result === "has_weapon") return reply("Your position already has a weapon.");
    if (result === "unavailable") return reply("This content is no longer open.");
    if (result === "not_found") return reply(INVALID);
    await refreshRoster(deps, id);
    return { type: UPDATE_MESSAGE, data: { content: `✅ You are bringing **${escapeText(weapon.name)}**.`, components: [], allowed_mentions: { parse: [] } } };
  }
  return reply(INVALID);
}
