import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, NOT_VALID, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { getRosterView } from "../db/content.ts";
import { getManageTargetById } from "../db/manage.ts";
import { leaveContent, type Promotion } from "../db/signup.ts";
import { announce, authorize, refreshRoster } from "./manage.ts";
import { announcePromotions } from "./waitlist.ts";
import { names } from "./fill.ts";
import { escapeText, rosterButton } from "../render/roster.ts";
import type { RosterView } from "../domain/types.ts";
import { displayNumber, withParty } from "../domain/parties.ts";
import { partyChoice, partyOfClick, slotsOfParty, userInParty } from "./party-pick.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNOWFLAKE = /^\d{5,25}$/;
const INVALID = "That panel is out of date. Press **Manage** on the roster, then **Remove player**, again.";

type Entry = { userId: string; where: string };

// Everyone who can be removed, in the order the roster shows them: seated players, applicants, fills, then the waitlist.
// Removing an applicant declines the application (FR-058).
function entries(view: RosterView, party: number): Entry[] {
  return [
    ...slotsOfParty(view, party).filter((s) => s.userId !== null).map((s) => ({ userId: s.userId!, where: `Position ${displayNumber(s, view.slots)} · ${s.role}` })),
    ...(view.applicants ?? []).filter((a) => userInParty(view, a.userId, party)).map((a) => ({ userId: a.userId, where: `Applicant · ${a.wants}` })),
    ...(view.fills ?? []).filter((u) => userInParty(view, u, party)).map((u) => ({ userId: u, where: "Fill" })),
    ...(view.waitlist ?? []).filter((w) => userInParty(view, w.userId, party)).map((w) => ({ userId: w.userId, where: `Waitlist · ${w.role}` })),
  ];
}

// The private panel of the Remove player button: a menu of everyone on the roster (the first 25).
async function panel(deps: Deps, view: RosterView, list: Entry[], party: number) {
  const shown = list.slice(0, 25);
  const who = await names(deps, view.guildId, shown.map((e) => e.userId));
  return {
    content: "Pick the player to remove from this roster.",
    components: [{
      type: 1,
      components: [{
        type: 3, custom_id: withParty(`rm:p:${view.id}`, party), placeholder: "Player to remove",
        options: shown.map((e) => ({
          label: Array.from(who[e.userId] ?? `Member ${e.userId.slice(-4)}`).slice(0, 100).join(""),
          description: Array.from(e.where).slice(0, 100).join(""),
          value: e.userId,
        })),
      }],
    }],
    allowed_mentions: { parse: [] as [] },
  };
}

// rm:<content> (the button on the private Manage panel), rm:p:<content> (a player chosen). The creator and admins only;
// checked on every click.
export async function handleRemoveComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = i.data as { custom_id?: unknown; values?: unknown } | undefined;
  const parts = typeof data?.custom_id === "string" ? data.custom_id.split(":") : [];
  const isButton = parts.length === 2 && UUID.test(parts[1] ?? "");
  const isGo = parts.length === 3 && parts[1] === "g"; // rm:g:<content>[@2]: the party chosen
  const id = isButton ? parts[1]! : parts[2];
  if (parts[0] !== "rm" || !id || !UUID.test(id) || !(isButton || isGo || (parts[1] === "p" && parts.length === 3)) || !i.guild_id || !i.member?.user?.id) return reply(INVALID);
  const checked = await authorize(deps, i, await getManageTargetById(deps.sql, id));
  if (!checked.ok) return checked.response;
  const view = await getRosterView(deps.sql, id, deps.now());
  if (!view) return reply(INVALID);
  if (view.status !== "open" && view.status !== "locked") return reply("This content is finished or cancelled.");

  const party = partyOfClick(i, view);
  if (party === null) return reply(NOT_VALID);
  if (isButton) {
    const row = partyChoice("rm:g", id, view);
    if (row) {
      if (!entries(view, 1).length && !entries(view, 2).length) return reply("Nobody is signed up.");
      return { type: CHANNEL_MESSAGE, data: { content: "Which party do you want to remove a player from?", components: [row], flags: EPHEMERAL, allowed_mentions: { parse: [] } } };
    }
    const list = entries(view, 1);
    if (list.length === 0) return reply("Nobody is signed up.");
    return { type: CHANNEL_MESSAGE, data: { ...(await panel(deps, view, list, 1)), flags: EPHEMERAL } };
  }
  if (isGo) {
    if (view.partyCount < 2) return reply(INVALID);
    const list = entries(view, party);
    if (list.length === 0) return reply(`Nobody is signed up in Party ${party}.`);
    return { type: UPDATE_MESSAGE, data: await panel(deps, view, list, party) };
  }
  const values = Array.isArray(data?.values) ? data!.values : [];
  const target = values[0];
  if (values.length !== 1 || typeof target !== "string" || !SNOWFLAKE.test(target)) return reply(INVALID);
  if (!entries(view, party).some((e) => e.userId === target)) return reply("That member is not on the roster any more.");
  const promoted: Promotion[] = [];
  const result = await leaveContent(deps.sql, { contentId: id, userId: target, guildId: i.guild_id, now: deps.now(), promoted });
  if (result !== "left") return reply("That member is not on the roster any more.");
  await refreshRoster(deps, id);
  const declined = (view.applicants ?? []).some((a) => a.userId === target);
  await announce(deps, view.threadId, declined
    ? `❌ <@${target}>, your application for **${escapeText(view.title)}** was declined by <@${i.member.user.id}>.`
    : `➖ <@${target}> was removed from **${escapeText(view.title)}** by <@${i.member.user.id}>.`, [target], rosterButton(view));
  await announcePromotions(deps, view.threadId, view.title, promoted, rosterButton(view));
  return { type: UPDATE_MESSAGE, data: { content: `✅ <@${target}> was removed.`, components: [], allowed_mentions: { parse: [] } } };
}
