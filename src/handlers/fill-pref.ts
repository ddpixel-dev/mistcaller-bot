import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, NOT_VALID, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { getRosterView } from "../db/content.ts";
import { joinFill, type Promotion } from "../db/signup.ts";
import { describeFill, MAX_FILL_VALUES, parseFillValues } from "../domain/fillmatch.ts";
import type { RosterView } from "../domain/types.ts";
import { roleIcon } from "../render/theme.ts";
import { positionText, withParty } from "../domain/parties.ts";
import { rosterButton } from "../render/roster.ts";
import { announce, refreshRoster } from "./manage.ts";
import { shownNumber, shownNumberOfSlot } from "./party-pick.ts";
import { announcePromotions, fillSeatedLine } from "./waitlist.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = "That panel is out of date. Choose Fill on the latest roster message again.";
const NOT_FOUND = "This content no longer exists.";

// FR-057: the private panel a player gets from Fill: Any position, or whole roles. One menu, several choices. (Single
// positions are still understood from a panel opened by 0.30.0, but are no longer offered: owner request 2026-11-06.)
export function fillPanel(view: RosterView, party = 1) {
  const roles = [...new Map(view.slots.filter((s) => s.party === party).map((s) => [s.role.toLowerCase(), s.role])).values()];
  const options: { label: string; value: string; description?: string; emoji: { name: string } }[] = [
    { label: "Any position", value: "any", description: "Healers first", emoji: { name: "🔁" } },
    ...roles.slice(0, MAX_FILL_VALUES - 1).map((r) => ({ label: `Any ${r} position`.slice(0, 100), value: `r:${r}`, emoji: { name: roleIcon(r) } })),
  ];
  return {
    content: "🔁 **Fill: what can you play?** Pick Any, or one or more roles. You are seated at once in the first matching open position (healers first), or you wait and are seated as soon as one frees up.",
    components: [{
      type: 1,
      components: [{ type: 3, custom_id: withParty(`fp:${view.id}`, party), placeholder: "Any, or a role", min_values: 1, max_values: options.length, options }],
    }],
    allowed_mentions: { parse: [] as [] },
  };
}

export async function openFillPanel(deps: Deps, contentId: string, party = 1): Promise<InteractionResponse> {
  const view = await getRosterView(deps.sql, contentId, deps.now());
  if (!view) return reply(NOT_FOUND);
  if (party > view.partyCount) return reply(NOT_VALID);
  if (view.status !== "open") return reply("Signups are locked for this content.");
  return { type: CHANNEL_MESSAGE, data: { ...fillPanel(view, party), flags: EPHEMERAL } };
}

const done = (content: string): InteractionResponse => ({ type: UPDATE_MESSAGE, data: { content, components: [], allowed_mentions: { parse: [] } } });

// fp:<content>: the panel's menu was submitted.
export async function handleFillChoice(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = i.data as { custom_id?: unknown; values?: unknown } | undefined;
  const parts = typeof data?.custom_id === "string" ? data.custom_id.split(":") : [];
  const userId = i.member?.user?.id;
  if (parts.length !== 2 || parts[0] !== "fp" || !UUID.test(parts[1]!) || !i.guild_id || !userId) return reply(INVALID);
  const pref = parseFillValues(data?.values);
  if (!pref) return reply(INVALID);
  const contentId = parts[1]!;
  const party = i.party ?? 1;
  if (party > 1 && party > ((await getRosterView(deps.sql, contentId, deps.now()))?.partyCount ?? 1)) return reply(NOT_VALID);

  const promoted: Promotion[] = [];
  const r = await joinFill(deps.sql, { contentId, userId, guildId: i.guild_id, now: deps.now(), pref, promoted, party });
  if (r.result === "not_found") return reply(NOT_FOUND);
  if (r.result === "locked") return reply("Signups are locked for this content.");
  if (r.result === "unchanged") return done("You are already waiting as a fill with those choices.");
  if (r.result === "selected") return done("You already hold a position. In a host-selected event only the host can move you.");

  const view = await getRosterView(deps.sql, contentId, deps.now());
  await refreshRoster(deps, contentId);
  if (view) await announcePromotions(deps, view.threadId, view.title, promoted, rosterButton(view));
  const wanted = describeFill(pref, (id) => (view ? shownNumberOfSlot(view, id) : undefined));
  if (r.result === "applied") {
    return done(`📨 You applied (${wanted}). The host picks the party; you are mentioned in the post when you are accepted.`);
  }
  if (r.result === "seated") {
    // The post says what the player asked for and where they landed (owner request 2026-11-06).
    const seat = { number: view ? shownNumber(view, r.slot.position) : r.slot.position, party, partyCount: view?.partyCount ?? 1, role: r.slot.role, weapon: r.slot.weapon };
    if (view) await announce(deps, view.threadId, `${fillSeatedLine(userId, wanted, seat)}`, [userId], rosterButton(view));
    const pick = r.slot.weapon ? "" : " Pick your weapon with `/content me`.";
    return done(`✅ You are seated in ${positionText(seat.partyCount, party, seat.number)} (${r.slot.role}).${pick}`);
  }
  return done(`🕒 No matching position is open. You are waiting as a fill (${wanted}) and will be seated automatically when one frees up.`);
}
