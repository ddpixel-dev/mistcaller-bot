import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { leafOption } from "../discord/modal.ts";
import { getAdminRoleIds } from "../db/settings.ts";
import { getRosterView } from "../db/content.ts";
import { getManageTarget, getManageTargetById, setSlotDuty } from "../db/manage.ts";
import { canManage } from "../domain/permissions.ts";
import { CLEAR_DUTY, DUTIES, DUTY_WORD, dutyDef } from "../domain/duties.ts";
import { renderRosterMessage } from "../render/roster.ts";
import { roleIcon } from "../render/theme.ts";
import { authorize, refreshRoster } from "./manage.ts";
import type { RosterView } from "../domain/types.ts";

// "/content duty position:<n> duty:<Caller|Scout|Rat|Looter|Catcher|Clear>": assigned by the content's managers.
export async function handleDutyCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const userId = i.member?.user?.id;
  if (!i.guild_id || !userId || !i.channel?.id) return reply("Use this command inside a content post.");
  const target = await getManageTarget(deps.sql, i.guild_id, i.channel.id);
  if (!target) return reply("There is no active content in this post.");
  const adminRoles = await getAdminRoleIds(deps.sql, i.guild_id);
  const allowed = canManage(
    { userId, roles: i.member?.roles ?? [], permissions: i.member?.permissions },
    { createdBy: target.createdBy },
    adminRoles,
  );
  if (!allowed) return reply("Only the creator, a member with Manage Server, or an admin role can do that.");

  const position = leafOption(i, "position");
  const duty = leafOption(i, "duty");
  if (typeof position !== "number" || !Number.isInteger(position) || position < 1 || position > 20) {
    return reply("Give the position number, from 1 to 20.");
  }
  if (typeof duty !== "string" || (duty !== CLEAR_DUTY && !dutyDef(duty))) return reply(`Pick a ${DUTY_WORD.toLowerCase()} from the list.`);

  const result = await setSlotDuty(deps.sql, { contentId: target.id, position, duty: duty === CLEAR_DUTY ? null : duty });
  if (result === "unavailable") return reply("This content is no longer open, so duties cannot change.");
  if (result === "no_slot") return reply(`There is no position ${position}.`);

  let refreshed = false;
  try {
    const view = await getRosterView(deps.sql, target.id, deps.now());
    if (view?.messageId) {
      await deps.rest.editMessage(view.threadId, view.messageId, renderRosterMessage(view));
      refreshed = true;
    }
  } catch (err) {
    console.error(JSON.stringify({ evt: "roster_refresh_failed", name: err instanceof Error ? err.name : "unknown" }));
  }
  const label = duty === CLEAR_DUTY ? `${DUTY_WORD} cleared` : `${dutyDef(duty)!.label} assigned`;
  return reply(`${label} for position ${position}.${refreshed ? "" : " The roster message will update on the next change."}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = "That panel is out of date. Press **Manage** on the roster, then **Set duty**, again.";

// The private Set duty panel (FR-048): every position, then (once one is chosen) the duties and Clear.
function dutyPanel(view: RosterView, position: number | null) {
  const rows: unknown[] = [{
    type: 1,
    components: [{
      type: 3, custom_id: `dt:p:${view.id}`, placeholder: "Position",
      options: view.slots.slice(0, 25).map((s) => ({
        label: Array.from(`${s.position}. ${s.role}${s.weapon ? ` - ${s.weapon}` : ""}`).slice(0, 100).join(""),
        value: String(s.position), default: s.position === position, emoji: { name: roleIcon(s.role) },
        ...(dutyDef(s.duty) ? { description: `Now: ${dutyDef(s.duty)!.label}` } : {}),
      })),
    }],
  }];
  if (position !== null) {
    rows.push({
      type: 1,
      components: [{
        type: 3, custom_id: `dt:d:${view.id}:${position}`, placeholder: DUTY_WORD,
        options: [
          ...DUTIES.map((x) => ({ label: x.label, value: x.id, emoji: { name: x.icon } })),
          { label: "Clear", value: CLEAR_DUTY, emoji: { name: "✖️" } },
        ],
      }],
    });
  }
  const content = position === null ? "Pick the position to give a duty." : `Now pick the duty for position ${position}.`;
  return { content, components: rows, allowed_mentions: { parse: [] as [] } };
}

// dt:<content> (the panel button), dt:p:<content> (a position chosen), dt:d:<content>:<position> (a duty chosen).
export async function handleDutyComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = i.data as { custom_id?: unknown; values?: unknown } | undefined;
  const parts = typeof data?.custom_id === "string" ? data.custom_id.split(":") : [];
  const values = Array.isArray(data?.values) ? data!.values : [];
  const isButton = parts.length === 2;
  const id = isButton ? parts[1] : parts[2];
  if (parts[0] !== "dt" || !id || !UUID.test(id)) return reply(INVALID);
  const checked = await authorize(deps, i, await getManageTargetById(deps.sql, id));
  if (!checked.ok) return checked.response;
  const view = await getRosterView(deps.sql, id, deps.now());
  if (!view) return reply(INVALID);

  if (isButton) return { type: CHANNEL_MESSAGE, data: { ...dutyPanel(view, null), flags: EPHEMERAL } };
  if (parts[1] === "p" && parts.length === 3) {
    const position = Number(values[0]);
    if (values.length !== 1 || !view.slots.some((s) => s.position === position)) return reply(INVALID);
    return { type: UPDATE_MESSAGE, data: dutyPanel(view, position) };
  }
  if (parts[1] === "d" && parts.length === 4 && /^\d{1,2}$/.test(parts[3]!)) {
    const duty = values[0];
    if (values.length !== 1 || typeof duty !== "string" || (duty !== CLEAR_DUTY && !dutyDef(duty))) return reply(INVALID);
    const position = Number(parts[3]);
    const result = await setSlotDuty(deps.sql, { contentId: id, position, duty: duty === CLEAR_DUTY ? null : duty });
    if (result === "unavailable") return reply("This content is no longer open, so duties cannot change.");
    if (result === "no_slot") return reply(`There is no position ${position}.`);
    await refreshRoster(deps, id);
    const label = duty === CLEAR_DUTY ? `${DUTY_WORD} cleared` : `${dutyDef(duty)!.label} assigned`;
    return { type: UPDATE_MESSAGE, data: { content: `✅ ${label} for position ${position}.`, components: [], allowed_mentions: { parse: [] } } };
  }
  return reply(INVALID);
}
