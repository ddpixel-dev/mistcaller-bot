import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { getRosterView } from "../db/content.ts";
import { getManageTargetById, setSlotDuty } from "../db/manage.ts";
import { CLEAR_DUTY, DUTIES, DUTY_WORD, dutyDef } from "../domain/duties.ts";
import { roleIcon } from "../render/theme.ts";
import { authorize, refreshRoster } from "./manage.ts";
import type { RosterView } from "../domain/types.ts";

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
