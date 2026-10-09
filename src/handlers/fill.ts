import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { subOption } from "../discord/modal.ts";
import { assignFill, type AssignResult } from "../db/signup.ts";
import { getRosterView } from "../db/content.ts";
import { getManageTarget, getManageTargetById } from "../db/manage.ts";
import { announce, authorize, refreshRoster } from "./manage.ts";
import { isOldRoster, OLD_LAYOUT } from "./signup.ts";
import { escapeText } from "../render/roster.ts";
import type { RosterView } from "../domain/types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNOWFLAKE = /^\d{5,25}$/;
const INVALID = "That panel is out of date. Press **Assign fill** on the roster again.";

const failure = (r: AssignResult["result"]): string =>
  r === "taken" ? "That position is already taken. Pick an open one."
  : r === "not_fill" ? "That member is not waiting as a fill any more."
  : r === "no_slot" ? "There is no such position on this roster."
  : r === "unavailable" ? "This content is finished or cancelled."
  : "This content no longer exists.";

async function names(deps: Deps, guildId: string, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!deps.rest.memberName) return out;
  await Promise.all(ids.map(async (u) => {
    const n = await deps.rest.memberName!(guildId, u);
    if (n) out[u] = n;
  }));
  return out;
}

// The private panel of the Assign fill button: the fill players, then (once one is chosen) the open positions.
async function panel(deps: Deps, view: RosterView, chosen: string | null) {
  const fills = (view.fills ?? []).slice(0, 25);
  const who = await names(deps, view.guildId, fills);
  const rows: unknown[] = [{
    type: 1,
    components: [{
      type: 3, custom_id: `fa:p:${view.id}`, placeholder: "Fill player",
      options: fills.map((u) => ({ label: (who[u] ?? `Member ${u.slice(-4)}`).slice(0, 100), value: u, default: u === chosen })),
    }],
  }];
  const open = view.slots.filter((s) => s.userId === null).slice(0, 25);
  if (chosen && open.length > 0) {
    rows.push({
      type: 1,
      components: [{
        type: 3, custom_id: `fa:s:${view.id}:${chosen}`, placeholder: "Open position",
        options: open.map((s) => ({
          label: Array.from(`${s.position}. ${s.role}${s.weapon ? ` - ${s.weapon}` : ""}`).slice(0, 100).join(""), value: s.id,
        })),
      }],
    });
  }
  const content = !chosen ? "Pick the fill player to place."
    : open.length > 0 ? `Now pick the position for <@${chosen}>.` : "There is no open position to place them in.";
  return { content, components: rows, allowed_mentions: { parse: [] as [] } };
}

async function finish(deps: Deps, view: RosterView, userId: string, r: Extract<AssignResult, { result: "ok" }>): Promise<void> {
  await refreshRoster(deps, view.id);
  await announce(deps, view.threadId, `🔁 <@${userId}> is now in position ${r.position} (${escapeText(r.role)}).`, [userId]);
}

// fa:<content> (the button), fa:p:<content> (a fill chosen), fa:s:<content>:<user> (a position chosen)
export async function handleAssignComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = i.data as { custom_id?: unknown; values?: unknown } | undefined;
  const parts = typeof data?.custom_id === "string" ? data.custom_id.split(":") : [];
  const values = Array.isArray(data?.values) ? data!.values : [];
  const isButton = parts.length === 2 && UUID.test(parts[1] ?? "");
  // Only the button sits on the roster. The two selects sit on the private panel, an ephemeral message that is never a roster.
  if (isButton && isOldRoster(i)) return reply(OLD_LAYOUT);
  const id = isButton ? parts[1]! : parts[2];
  if (parts[0] !== "fa" || !id || !UUID.test(id) || !i.guild_id || !i.member?.user?.id) return reply(INVALID);
  const checked = await authorize(deps, i, await getManageTargetById(deps.sql, id));
  if (!checked.ok) return checked.response;
  const view = await getRosterView(deps.sql, id, deps.now());
  if (!view) return reply(INVALID);

  if (isButton) {
    if ((view.fills ?? []).length === 0) return reply("Nobody is waiting as a fill.");
    return { type: CHANNEL_MESSAGE, data: { ...(await panel(deps, view, null)), flags: EPHEMERAL } };
  }
  if (parts[1] === "p" && parts.length === 3) {
    const picked = values[0];
    if (values.length !== 1 || typeof picked !== "string" || !(view.fills ?? []).includes(picked)) return reply("That member is not waiting as a fill any more.");
    return { type: UPDATE_MESSAGE, data: await panel(deps, view, picked) };
  }
  if (parts[1] === "s" && parts.length === 4 && SNOWFLAKE.test(parts[3]!)) {
    const slotId = values[0];
    if (values.length !== 1 || typeof slotId !== "string" || !UUID.test(slotId)) return reply(INVALID);
    const r = await assignFill(deps.sql, { contentId: id, guildId: i.guild_id, userId: parts[3]!, slotId });
    if (r.result !== "ok") return reply(failure(r.result));
    await finish(deps, view, parts[3]!, r);
    return { type: UPDATE_MESSAGE, data: { content: `✅ <@${parts[3]}> is now in position ${r.position}.`, components: [], allowed_mentions: { parse: [] } } };
  }
  return reply(INVALID);
}

// /content assign position:<n> member:@user: the same, in one command, inside the content's post.
export async function handleAssignCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const target = i.guild_id && i.channel?.id ? await getManageTarget(deps.sql, i.guild_id, i.channel.id) : null;
  const checked = await authorize(deps, i, target);
  if (!checked.ok) return checked.response;
  const position = subOption(i, "assign", "position");
  const member = subOption(i, "assign", "member");
  if (typeof position !== "number" || !Number.isInteger(position) || position < 1 || position > 20) return reply("Give the position number, from 1 to 20.");
  if (typeof member !== "string" || !SNOWFLAKE.test(member)) return reply("Pick the member who is waiting as a fill.");
  const r = await assignFill(deps.sql, { contentId: checked.target.id, guildId: i.guild_id!, userId: member, position });
  if (r.result !== "ok") return reply(failure(r.result));
  const view = await getRosterView(deps.sql, checked.target.id, deps.now());
  if (view) await finish(deps, view, member, r);
  return reply(`<@${member}> is now in position ${r.position}.`);
}
