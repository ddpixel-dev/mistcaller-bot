import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { getRosterView } from "../db/content.ts";
import { joinFill, type Promotion } from "../db/signup.ts";
import { describeFill, MAX_FILL_VALUES, parseFillValues } from "../domain/fillmatch.ts";
import type { RosterView } from "../domain/types.ts";
import { roleIcon } from "../render/theme.ts";
import { announce, refreshRoster } from "./manage.ts";
import { announcePromotions, fillSeatedLine } from "./waitlist.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = "That panel is out of date. Choose Fill on the latest roster message again.";
const NOT_FOUND = "This content no longer exists.";

// FR-057: the private panel a player gets from Fill. One menu, several choices: Any position, whole roles, single
// positions. A Discord menu holds 25 options, so on a big roster the roles come first and the positions fill the rest.
export function fillPanel(view: RosterView) {
  const roles = [...new Map(view.slots.map((s) => [s.role.toLowerCase(), s.role])).values()];
  const options: { label: string; value: string; description?: string; emoji: { name: string } }[] = [
    { label: "Any position", value: "any", description: "Healers first", emoji: { name: "🔁" } },
    ...roles.slice(0, 8).map((r) => ({ label: `Any ${r} position`.slice(0, 100), value: `r:${r}`, emoji: { name: roleIcon(r) } })),
  ];
  const positions = view.slots.map((s) => ({
    label: Array.from(`${s.position}. ${s.role}${s.weapon ? ` - ${s.weapon}` : ""}`).slice(0, 100).join(""),
    value: `s:${s.id}`, description: s.userId ? "Taken now" : "Open", emoji: { name: roleIcon(s.role) },
  }));
  const room = MAX_FILL_VALUES - options.length;
  options.push(...positions.slice(0, room));
  const cut = positions.length > room;
  return {
    content: [
      "🔁 **Fill: what can you play?** Pick one or more. You are seated at once in the first matching open position (healers first), or you wait and are seated as soon as one frees up.",
      ...(cut ? ["Only the first positions are listed; pick a role to cover the rest."] : []),
    ].join("\n"),
    components: [{
      type: 1,
      components: [{ type: 3, custom_id: `fp:${view.id}`, placeholder: "Any, a role, or positions", min_values: 1, max_values: options.length, options }],
    }],
    allowed_mentions: { parse: [] as [] },
  };
}

export async function openFillPanel(deps: Deps, contentId: string): Promise<InteractionResponse> {
  const view = await getRosterView(deps.sql, contentId, deps.now());
  if (!view) return reply(NOT_FOUND);
  if (view.status !== "open") return reply("Signups are locked for this content.");
  return { type: CHANNEL_MESSAGE, data: { ...fillPanel(view), flags: EPHEMERAL } };
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

  const promoted: Promotion[] = [];
  const r = await joinFill(deps.sql, { contentId, userId, guildId: i.guild_id, now: deps.now(), pref, promoted });
  if (r.result === "not_found") return reply(NOT_FOUND);
  if (r.result === "locked") return reply("Signups are locked for this content.");
  if (r.result === "unchanged") return done("You are already waiting as a fill with those choices.");

  const view = await getRosterView(deps.sql, contentId, deps.now());
  await refreshRoster(deps, contentId);
  if (view) await announcePromotions(deps, view.threadId, view.title, promoted);
  const wanted = describeFill(pref, (id) => view?.slots.find((s) => s.id === id)?.position);
  if (r.result === "seated") {
    // The post says what the player asked for and where they landed (owner request 2026-11-06).
    if (view) await announce(deps, view.threadId, fillSeatedLine(userId, wanted, { position: r.slot.position, role: r.slot.role, weapon: r.slot.weapon }), [userId]);
    const pick = r.slot.weapon ? "" : " Pick your weapon with `/content me`.";
    return done(`✅ You are seated in position ${r.slot.position} (${r.slot.role}).${pick}`);
  }
  return done(`🕒 No matching position is open. You are waiting as a fill (${wanted}) and will be seated automatically when one frees up.`);
}
