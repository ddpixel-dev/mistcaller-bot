import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, NOT_VALID, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { assignPlayer, type AssignResult, type Promotion } from "../db/signup.ts";
import { getRosterView } from "../db/content.ts";
import { getManageTargetById } from "../db/manage.ts";
import { announce, authorize, refreshRoster } from "./manage.ts";
import { announcePromotions } from "./waitlist.ts";
import { escapeText, rosterButton } from "../render/roster.ts";
import { fillMatches } from "../domain/fillmatch.ts";
import { roleIcon } from "../render/theme.ts";
import type { RosterView } from "../domain/types.ts";
import { displayNumber, withParty } from "../domain/parties.ts";
import { partyChoice, partyOfClick, shownNumber, slotsOfParty, userInParty } from "./party-pick.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNOWFLAKE = /^\d{5,25}$/;
const INVALID = "That panel is out of date. Press **Manage** on the roster, then **Assign player** or **Review applicants**, again.";
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

// FR-065: two private panels share the steps. "review" lists only the people who applied (a host-selected event);
// "assign" lists the players waiting as fills and a member picker for anyone else, and never the applicants.
type Mode = "review" | "assign";

// The private Assign player panel (FR-047; Sign up player in 0.22.0, Add player in 0.23.0) and the Review applicants panel
// (FR-058): the candidates first, then (once a player is chosen) the open positions.
async function panel(deps: Deps, view: RosterView, chosen: string | null, mode: Mode = "assign", party = 1) {
  // FR-070: on a two-party CTA the panel is about one party: its applicants, fills and positions.
  const applicants = mode === "review" ? (view.applicants ?? []).filter((a) => userInParty(view, a.userId, party)).slice(0, 25) : [];
  const waiting = mode === "review" ? [] : (view.fills ?? []).filter((u) => userInParty(view, u, party)).slice(0, 25);
  const candidates = [...applicants.map((a) => a.userId), ...waiting];
  const who = await names(deps, view.guildId, candidates);
  const tentative = new Set(view.tentative ?? []);
  const fills = candidates;
  const rows: unknown[] = [];
  if (fills.length > 0) {
    rows.push({
      type: 1,
      components: [{
        type: 3, custom_id: withParty(`${mode === "review" ? "fa:q" : "fa:p"}:${view.id}`, party), placeholder: mode === "review" ? "An applicant" : "A player waiting as a fill",
        options: [
          ...applicants.map((a) => ({
            label: (who[a.userId] ?? `Member ${a.userId.slice(-4)}`).slice(0, 100), value: a.userId, default: a.userId === chosen,
            description: Array.from(`${tentative.has(a.userId) ? "❓ Tentative · " : ""}Applied: ${a.wants}`).slice(0, 100).join(""), emoji: { name: "📨" },
          })),
          ...waiting.map((u) => ({
            label: (who[u] ?? `Member ${u.slice(-4)}`).slice(0, 100), value: u, default: u === chosen, emoji: { name: "🔁" },
            ...(tentative.has(u) ? { description: "❓ Tentative" } : {}), // FR-067
          })),
        ],
      }],
    });
  }
  const picked = chosen && !fills.includes(chosen) ? chosen : null;
  if (mode === "assign") {
    rows.push({
      type: 1,
      components: [{
        type: 5, custom_id: withParty(`fa:u:${view.id}`, party), placeholder: fills.length > 0 ? "Or any member" : "Any member",
        ...(picked ? { default_values: [{ id: picked, type: "user" }] } : {}),
      }],
    });
  }
  // FR-057: for a fill or an applicant, only the open positions that match what they asked for; any other member can go anywhere.
  const pref = chosen ? view.applicants?.find((a) => a.userId === chosen)?.pref ?? view.fillPrefs?.[chosen] ?? null : null;
  const allOpen = slotsOfParty(view, party).filter((s) => s.userId === null);
  const open = allOpen.filter((s) => !pref || fillMatches(pref, s)).slice(0, 25);
  if (chosen && open.length > 0) {
    rows.push({
      type: 1,
      components: [{
        type: 3, custom_id: withParty(`fa:s:${view.id}:${chosen}`, party), placeholder: "Open position",
        options: open.map((s) => ({
          label: Array.from(`${displayNumber(s, view.slots)}. ${s.role}${s.weapon ? ` - ${s.weapon}` : ""}`).slice(0, 100).join(""), value: s.id,
          emoji: { name: roleIcon(s.role) },
        })),
      }],
    });
  }
  const content = !chosen ? (mode === "review" ? (applicants.length ? "Pick the applicant to accept." : "Nobody has applied yet.") : "Pick the player to assign: a fill, or any member.")
    : open.length > 0 ? `Now pick the position for <@${chosen}>${pref ? " (only the open positions that suit what they asked for)" : ""}.`
    : allOpen.length > 0 ? `No open position suits what <@${chosen}> asked for. Add one with **Edit details**, or pick someone else.` : "There is no open position to place them in.";
  return { content, components: rows, allowed_mentions: { parse: [] as [] } };
}

// The roster is refreshed and the thread is told who signed whom up (owner request 2026-10-24: very important).
// Only the player is pinged; the host's name shows without a ping.
async function finish(deps: Deps, view: RosterView, host: string, userId: string, r: Extract<AssignResult, { result: "ok" }>, promoted: Promotion[]): Promise<void> {
  const accepted = (view.applicants ?? []).some((a) => a.userId === userId);
  await refreshRoster(deps, view.id);
  // A position without a weapon: the player's own pick was cleared by the move, so they choose again (ADR 0029).
  const shown = shownNumber(view, r.position);
  const pick = view.slots.some((s) => s.position === r.position && !s.weapon) ? " Pick your weapon with `/content me`." : "";
  await announce(deps, view.threadId, accepted
    ? `✅ <@${host}> accepted <@${userId}> for position ${shown} (${roleIcon(r.role)} ${escapeText(r.role)}).${pick}`
    : `📝 <@${host}> signed up <@${userId}> for position ${shown} (${roleIcon(r.role)} ${escapeText(r.role)}).${pick}`, [userId], rosterButton(view));
  await announcePromotions(deps, view.threadId, view.title, promoted, rosterButton(view));
}

// fa:<content> (open the Assign player panel), fa:r:<content> (open Review applicants), fa:p:<content> (a fill chosen),
// fa:q:<content> (an applicant chosen), fa:u:<content> (a member picked), fa:s:<content>:<user> (a position chosen). The panel sits on the private Manage panel, never on a roster.
export async function handleAssignComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = i.data as { custom_id?: unknown; values?: unknown } | undefined;
  const parts = typeof data?.custom_id === "string" ? data.custom_id.split(":") : [];
  const values = Array.isArray(data?.values) ? data!.values : [];
  const isButton = parts.length === 2 && UUID.test(parts[1] ?? "");
  const isReviewButton = parts.length === 3 && parts[1] === "r";
  const id = isButton ? parts[1]! : parts[2];
  const host = i.member?.user?.id;
  if (parts[0] !== "fa" || !id || !UUID.test(id) || !i.guild_id || !host) return reply(INVALID);
  const checked = await authorize(deps, i, await getManageTargetById(deps.sql, id));
  if (!checked.ok) return checked.response;
  const view = await getRosterView(deps.sql, id, deps.now());
  if (!view) return reply(INVALID);
  if (view.status !== "open" && view.status !== "locked") return reply("This content is finished or cancelled.");

  const party = partyOfClick(i, view);
  if (party === null) return reply(NOT_VALID);

  // A two-party CTA asks for the party first (fa:g and fa:rg carry the choice); one party opens the panel directly.
  if (isButton || isReviewButton) {
    const row = partyChoice(isReviewButton ? "fa:rg" : "fa:g", id, view);
    if (row) return { type: CHANNEL_MESSAGE, data: { content: "Which party is this for?", components: [row], flags: EPHEMERAL, allowed_mentions: { parse: [] } } };
    return { type: CHANNEL_MESSAGE, data: { ...(await panel(deps, view, null, isReviewButton ? "review" : "assign")), flags: EPHEMERAL } };
  }
  if ((parts[1] === "g" || parts[1] === "rg") && parts.length === 3 && view.partyCount > 1) {
    return { type: UPDATE_MESSAGE, data: await panel(deps, view, null, parts[1] === "rg" ? "review" : "assign", party) };
  }
  if ((parts[1] === "p" || parts[1] === "q" || parts[1] === "u") && parts.length === 3) {
    const picked = values[0];
    if (values.length !== 1 || typeof picked !== "string" || !SNOWFLAKE.test(picked)) return reply(INVALID);
    if (isBot(i, picked)) return reply(NO_BOTS);
    return { type: UPDATE_MESSAGE, data: await panel(deps, view, picked, parts[1] === "q" ? "review" : "assign", party) };
  }
  if (parts[1] === "s" && parts.length === 4 && SNOWFLAKE.test(parts[3]!)) {
    const slotId = values[0];
    if (values.length !== 1 || typeof slotId !== "string" || !UUID.test(slotId)) return reply(INVALID);
    if (view.slots.find((s) => s.id === slotId)?.party !== party) return reply(INVALID);
    const promoted: Promotion[] = [];
    const r = await assignPlayer(deps.sql, { contentId: id, guildId: i.guild_id, userId: parts[3]!, slotId, now: deps.now(), promoted });
    if (r.result !== "ok") return reply(failure(r.result, shownNumber(view, view.slots.find((s) => s.id === slotId)!.position)));
    await finish(deps, view, host, parts[3]!, r, promoted);
    return { type: UPDATE_MESSAGE, data: { content: `✅ <@${parts[3]}> is now in position ${shownNumber(view, r.position)}.`, components: [], allowed_mentions: { parse: [] } } };
  }
  return reply(INVALID);
}
