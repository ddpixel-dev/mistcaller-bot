import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { WEAPONS } from "../data/weapons.ts";
import { SLOT_LABEL, WEAPON_CLASSES, isWeaponClass, weaponsOfClass, type WeaponClass } from "../domain/weapons.ts";
import { getRosterView } from "../db/content.ts";
import { getManageTargetById, setSlotWeapon } from "../db/manage.ts";
import { announce, authorize, refreshRoster } from "./manage.ts";
import { escapeText } from "../render/roster.ts";
import { roleIcon } from "../render/theme.ts";
import { weaponEmojiByName } from "../render/weaponIcon.ts";
import type { RosterView } from "../domain/types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = "That panel is out of date. Press **Manage** on the roster, then **Set weapon**, again.";

// The private Set weapon panel (ADR 0029): a position without a weapon, then the weapon class, then the weapon.
function weaponPanel(view: RosterView, position: number | null, cls: WeaponClass | null) {
  const open = view.slots.filter((s) => !s.weapon).slice(0, 25);
  const rows: unknown[] = [{
    type: 1,
    components: [{
      type: 3, custom_id: `sw:p:${view.id}`, placeholder: "Position without a weapon",
      options: open.map((s) => ({
        label: Array.from(`${s.position}. ${s.role}`).slice(0, 100).join(""), value: String(s.position), default: s.position === position,
        emoji: { name: roleIcon(s.role) }, ...(s.chosenWeapon ? { description: Array.from(`Player's pick: ${s.chosenWeapon}`).slice(0, 100).join("") } : {}),
      })),
    }],
  }];
  if (position !== null) {
    rows.push({
      type: 1,
      components: [{
        type: 3, custom_id: `sw:c:${view.id}:${position}`, placeholder: "Weapon class",
        options: WEAPON_CLASSES.filter((c) => c !== "Other").map((c) => ({ label: c, value: c, default: c === cls })),
      }],
    });
  }
  const list = position !== null && cls ? weaponsOfClass(WEAPONS, cls).slice(0, 25) : [];
  if (list.length > 0) {
    rows.push({
      type: 1,
      components: [{
        type: 3, custom_id: `sw:w:${view.id}:${position}:${cls}`, placeholder: "Weapon",
        options: list.map((w) => ({
          label: `${w.name} (${SLOT_LABEL[w.slot]})`.slice(0, 100), value: w.base, ...(weaponEmojiByName(w.name) ? { emoji: weaponEmojiByName(w.name)! } : {}),
        })),
      }],
    });
  }
  const content = position === null ? "Pick the position to give a weapon."
    : !cls ? `Now pick the weapon class for position ${position}.` : `Now pick the weapon for position ${position}.`;
  return { content, components: rows, allowed_mentions: { parse: [] as [] } };
}

// sw:<content> (the panel button), sw:p:<content> (a position), sw:c:<content>:<position> (a class),
// sw:w:<content>:<position>:<class> (the weapon). The creator and admins only; checked on every click.
export async function handleSetWeaponComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = i.data as { custom_id?: unknown; values?: unknown } | undefined;
  const parts = typeof data?.custom_id === "string" ? data.custom_id.split(":") : [];
  const values = Array.isArray(data?.values) ? data!.values : [];
  const isButton = parts.length === 2;
  const id = isButton ? parts[1] : parts[2];
  const host = i.member?.user?.id;
  if (parts[0] !== "sw" || !id || !UUID.test(id) || !host) return reply(INVALID);
  const checked = await authorize(deps, i, await getManageTargetById(deps.sql, id));
  if (!checked.ok) return checked.response;
  const view = await getRosterView(deps.sql, id, deps.now());
  if (!view) return reply(INVALID);
  if (view.status !== "open" && view.status !== "locked") return reply("This content is finished or cancelled.");

  const position = parts[3] !== undefined ? Number(parts[3]) : null;
  const positionOk = (n: number | null) => n !== null && view.slots.some((s) => s.position === n && !s.weapon);
  if (isButton) {
    if (!view.slots.some((s) => !s.weapon)) return reply("Every position already has a weapon. Use **Edit**, then **Edit details**, to change one.");
    return { type: CHANNEL_MESSAGE, data: { ...weaponPanel(view, null, null), flags: EPHEMERAL } };
  }
  if (parts[1] === "p" && parts.length === 3) {
    const n = Number(values[0]);
    if (values.length !== 1 || !positionOk(n)) return reply(INVALID);
    return { type: UPDATE_MESSAGE, data: weaponPanel(view, n, null) };
  }
  if (parts[1] === "c" && parts.length === 4) {
    const cls = values[0];
    if (values.length !== 1 || typeof cls !== "string" || !isWeaponClass(cls) || !positionOk(position)) return reply(INVALID);
    return { type: UPDATE_MESSAGE, data: weaponPanel(view, position, cls) };
  }
  if (parts[1] === "w" && parts.length === 5 && isWeaponClass(parts[4]!)) {
    const weapon = weaponsOfClass(WEAPONS, parts[4]! as WeaponClass).find((w) => w.base === values[0]);
    if (values.length !== 1 || !weapon || position === null) return reply(INVALID);
    const r = await setSlotWeapon(deps.sql, { contentId: id, position, weapon: weapon.name });
    if (r.result !== "ok") {
      return reply(r.result === "has_weapon" ? "That position already has a weapon."
        : r.result === "no_slot" ? `There is no position ${position}.` : "This content is finished or cancelled.");
    }
    await refreshRoster(deps, id);
    // A player whose own pick was replaced is told in the post (owner decision 2026-10-24); only they are pinged.
    if (r.holder && r.replaced) {
      await announce(
        deps, view.threadId,
        `🗡️ <@${host}> set the weapon of position ${position} to **${escapeText(weapon.name)}**. <@${r.holder}>, it replaces your pick (${escapeText(r.replaced)}).`,
        [r.holder],
      );
    }
    return { type: UPDATE_MESSAGE, data: { content: `✅ Position ${position} now uses ${escapeText(weapon.name)}.`, components: [], allowed_mentions: { parse: [] } } };
  }
  return reply(INVALID);
}
