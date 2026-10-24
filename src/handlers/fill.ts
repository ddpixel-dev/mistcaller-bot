import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { subOption } from "../discord/modal.ts";
import { assignPlayer, type AssignResult, type Promotion } from "../db/signup.ts";
import { getRosterView } from "../db/content.ts";
import { getManageTarget, getManageTargetById } from "../db/manage.ts";
import { announce, authorize, refreshRoster } from "./manage.ts";
import { announcePromotions } from "./waitlist.ts";
import { escapeText } from "../render/roster.ts";
import { roleIcon } from "../render/theme.ts";
import type { RosterView } from "../domain/types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNOWFLAKE = /^\d{5,25}$/;
const INVALID = "That panel is out of date. Press **Manage** on the roster, then **Sign up player**, again.";
const NO_BOTS = "Bots cannot be signed up.";

const failure = (r: AssignResult["result"], position?: number): string =>
  r === "taken" ? "That position is already taken. Pick an open one."
  : r === "unchanged" ? `That member is already in position ${position ?? "that position"}.`
  : r === "no_slot" ? "There is no such position on this roster."
  : r === "unavailable" ? "This content is finished or cancelled."
  : "This content no longer exists.";

export async function names(deps: Deps, guildId: string, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!deps.rest.memberName) return out;
  await Promise.all(ids.map(async (u) => {
    const n = await deps.rest.memberName!(guildId, u);
    if (n) out[u] = n;
  }));
  return out;
}

// A member picked in a picker or a command option is a bot when Discord says so in the resolved data.
function isBot(i: Interaction, userId: string): boolean {
  const users = (i.data as { resolved?: { users?: Record<string, { bot?: unknown }> } } | undefined)?.resolved?.users;
  return users?.[userId]?.bot === true;
}

// The private Sign up player panel (FR-047): the players waiting as fills first, then a member picker for anyone else,
// then (once a player is chosen) the open positions.
async function panel(deps: Deps, view: RosterView, chosen: string | null) {
  const fills = (view.fills ?? []).slice(0, 25);
  const who = await names(deps, view.guildId, fills);
  const rows: unknown[] = [];
  if (fills.length > 0) {
    rows.push({
      type: 1,
      components: [{
        type: 3, custom_id: `fa:p:${view.id}`, placeholder: "A player waiting as a fill",
        options: fills.map((u) => ({ label: (who[u] ?? `Member ${u.slice(-4)}`).slice(0, 100), value: u, default: u === chosen, emoji: { name: "🔁" } })),
      }],
    });
  }
  const picked = chosen && !fills.includes(chosen) ? chosen : null;
  rows.push({
    type: 1,
    components: [{
      type: 5, custom_id: `fa:u:${view.id}`, placeholder: "Or any member",
      ...(picked ? { default_values: [{ id: picked, type: "user" }] } : {}),
    }],
  });
  const open = view.slots.filter((s) => s.userId === null).slice(0, 25);
  if (chosen && open.length > 0) {
    rows.push({
      type: 1,
      components: [{
        type: 3, custom_id: `fa:s:${view.id}:${chosen}`, placeholder: "Open position",
        options: open.map((s) => ({
          label: Array.from(`${s.position}. ${s.role}${s.weapon ? ` - ${s.weapon}` : ""}`).slice(0, 100).join(""), value: s.id,
          emoji: { name: roleIcon(s.role) },
        })),
      }],
    });
  }
  const content = !chosen ? "Pick the player to sign up: a fill, or any member."
    : open.length > 0 ? `Now pick the position for <@${chosen}>.` : "There is no open position to place them in.";
  return { content, components: rows, allowed_mentions: { parse: [] as [] } };
}

// The roster is refreshed and the thread is told who signed whom up (owner request 2026-10-24: very important).
// Only the player is pinged; the host's name shows without a ping.
async function finish(deps: Deps, view: RosterView, host: string, userId: string, r: Extract<AssignResult, { result: "ok" }>, promoted: Promotion[]): Promise<void> {
  await refreshRoster(deps, view.id);
  await announce(deps, view.threadId, `📝 <@${host}> signed up <@${userId}> for position ${r.position} (${roleIcon(r.role)} ${escapeText(r.role)}).`, [userId]);
  await announcePromotions(deps, view.threadId, view.title, promoted);
}

// fa:<content> (open the panel), fa:p:<content> (a fill chosen), fa:u:<content> (a member picked),
// fa:s:<content>:<user> (a position chosen). The panel sits on the private Manage panel, never on a roster.
export async function handleAssignComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = i.data as { custom_id?: unknown; values?: unknown } | undefined;
  const parts = typeof data?.custom_id === "string" ? data.custom_id.split(":") : [];
  const values = Array.isArray(data?.values) ? data!.values : [];
  const isButton = parts.length === 2 && UUID.test(parts[1] ?? "");
  const id = isButton ? parts[1]! : parts[2];
  const host = i.member?.user?.id;
  if (parts[0] !== "fa" || !id || !UUID.test(id) || !i.guild_id || !host) return reply(INVALID);
  const checked = await authorize(deps, i, await getManageTargetById(deps.sql, id));
  if (!checked.ok) return checked.response;
  const view = await getRosterView(deps.sql, id, deps.now());
  if (!view) return reply(INVALID);
  if (view.status !== "open" && view.status !== "locked") return reply("This content is finished or cancelled.");

  if (isButton) return { type: CHANNEL_MESSAGE, data: { ...(await panel(deps, view, null)), flags: EPHEMERAL } };
  if ((parts[1] === "p" || parts[1] === "u") && parts.length === 3) {
    const picked = values[0];
    if (values.length !== 1 || typeof picked !== "string" || !SNOWFLAKE.test(picked)) return reply(INVALID);
    if (isBot(i, picked)) return reply(NO_BOTS);
    return { type: UPDATE_MESSAGE, data: await panel(deps, view, picked) };
  }
  if (parts[1] === "s" && parts.length === 4 && SNOWFLAKE.test(parts[3]!)) {
    const slotId = values[0];
    if (values.length !== 1 || typeof slotId !== "string" || !UUID.test(slotId)) return reply(INVALID);
    const promoted: Promotion[] = [];
    const r = await assignPlayer(deps.sql, { contentId: id, guildId: i.guild_id, userId: parts[3]!, slotId, now: deps.now(), promoted });
    if (r.result !== "ok") return reply(failure(r.result, view.slots.find((s) => s.id === slotId)?.position));
    await finish(deps, view, host, parts[3]!, r, promoted);
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
  if (typeof member !== "string" || !SNOWFLAKE.test(member)) return reply("Pick the member to sign up.");
  if (isBot(i, member)) return reply(NO_BOTS);
  const promoted: Promotion[] = [];
  const r = await assignPlayer(deps.sql, { contentId: checked.target.id, guildId: i.guild_id!, userId: member, position, now: deps.now(), promoted });
  if (r.result !== "ok") return reply(failure(r.result, position));
  const view = await getRosterView(deps.sql, checked.target.id, deps.now());
  if (view) await finish(deps, view, i.member!.user!.id, member, r, promoted);
  return reply(`<@${member}> is now in position ${r.position}.`);
}
