import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { getRosterView } from "../db/content.ts";
import { claimSlot, joinFill, joinWaitlist, leaveContent, type Promotion } from "../db/signup.ts";
import { pickerResponse } from "./weapon-pick.ts";
import { announcePromotions } from "./waitlist.ts";
import { FILL_VALUE, IS_COMPONENTS_V2, WAIT_FILL_VALUE, escapeText, renderRosterMessage } from "../render/roster.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = "That action is not valid. Please use the controls on the latest roster message.";
const NOT_FOUND = "This content or position no longer exists.";
export const OLD_LAYOUT =
  "This roster was posted with an older layout, which can no longer be updated. Ask its creator to cancel it and create a new one.";

// Discord cannot turn an old (embed) message into the new layout, so its controls only explain this.
export function isOldRoster(i: Interaction): boolean {
  return i.message !== undefined && ((i.message.flags ?? 0) & IS_COMPONENTS_V2) === 0;
}

// The id of the content, from a custom id like "join:<id>" or "leaveslot:<id>:<slot>".
function ids(i: Interaction, prefix: string, parts: number): string[] | null {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  if (typeof raw !== "string") return null;
  const p = raw.split(":");
  if (p.length !== parts || p[0] !== prefix || !p.slice(1).every((x) => UUID.test(x))) return null;
  return p.slice(1);
}

// Everyone sees the same roster, so a change answers by updating the shared message.
async function refreshed(deps: Deps, id: string, promoted: Promotion[] = []): Promise<InteractionResponse> {
  const view = await getRosterView(deps.sql, id, deps.now());
  if (!view) return reply(NOT_FOUND);
  await announcePromotions(deps, view.threadId, view.title, promoted);
  return { type: UPDATE_MESSAGE, data: renderRosterMessage(view) };
}

// The menu of open positions: sign up, or move from the position you hold. A taken position is not listed.
export async function handleJoin(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  if (isOldRoster(i)) return reply(OLD_LAYOUT);
  const got = ids(i, "join", 2);
  const userId = i.member?.user?.id;
  const guildId = i.guild_id;
  const values = (i.data as { values?: unknown } | undefined)?.values;
  if (!got || !userId || !guildId || !Array.isArray(values) || values.length !== 1) return reply(INVALID);
  const slotId = values[0];
  if (slotId === FILL_VALUE) return await fill(deps, got[0]!, userId, guildId);
  if (typeof slotId !== "string" || !UUID.test(slotId)) return reply(INVALID);
  const promoted: Promotion[] = [];
  const result = await claimSlot(deps.sql, { contentId: got[0]!, slotId, userId, guildId, now: deps.now(), promoted });
  if (result === "unchanged") return reply("You already hold this position.");
  if (result === "taken") return reply("That position was just taken. Pick another one from the menu.");
  if (result === "locked") return reply("Signups are locked for this content.");
  if (result === "not_found") return reply(NOT_FOUND);
  // A slot without a weapon (FR-030): update the roster through the API, and give the player a private weapon picker.
  const [slot] = await deps.sql`select role, position, weapon from slot where id = ${slotId}`;
  if (slot && slot.weapon === null) {
    const view = await getRosterView(deps.sql, got[0]!, deps.now());
    if (view?.messageId) {
      try {
        await deps.rest.editMessage(view.threadId, view.messageId, renderRosterMessage(view));
        await announcePromotions(deps, view.threadId, view.title, promoted);
        return pickerResponse(got[0]!, `You are in **${slot.position}. ${escapeText(slot.role)}**. Which weapon will you bring? This is optional.`);
      } catch (err) {
        console.error(JSON.stringify({ evt: "roster_refresh_failed", name: err instanceof Error ? err.name : "unknown" }));
      }
    }
  }
  return await refreshed(deps, got[0]!, promoted);
}

// FR-032: sign up as Fill, a member without a position. The owner places fills later.
async function fill(deps: Deps, contentId: string, userId: string, guildId: string): Promise<InteractionResponse> {
  const promoted: Promotion[] = [];
  const result = await joinFill(deps.sql, { contentId, userId, guildId, now: deps.now(), promoted });
  if (result === "unchanged") return reply("You are already listed as a fill.");
  if (result === "locked") return reply("Signups are locked for this content.");
  if (result === "not_found") return reply(NOT_FOUND);
  return await refreshed(deps, contentId, promoted);
}

// FR-007 (per role): wait for a role whose positions are all taken. A seat for that role goes to the first waiter.
export async function handleWait(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  if (isOldRoster(i)) return reply(OLD_LAYOUT);
  const got = ids(i, "wait", 2);
  const userId = i.member?.user?.id;
  const guildId = i.guild_id;
  const values = (i.data as { values?: unknown } | undefined)?.values;
  if (!got || !userId || !guildId || !Array.isArray(values) || values.length !== 1) return reply(INVALID);
  const role = values[0];
  if (role === WAIT_FILL_VALUE) return await fill(deps, got[0]!, userId, guildId);
  if (typeof role !== "string" || role.length === 0 || role.length > 100) return reply(INVALID);
  const result = await joinWaitlist(deps.sql, { contentId: got[0]!, userId, guildId, role, now: deps.now() });
  if (result === "already") return reply(`You are already waiting for ${role}.`);
  if (result === "signed") return reply("You hold a position. Leave it first, then join the waitlist.");
  if (result === "open_slot") return reply(`A ${role} position just opened. Pick it from the menu.`);
  if (result === "unknown_role") return reply("That role is not on this roster.");
  if (result === "locked") return reply("Signups are locked for this content.");
  if (result === "not_found") return reply(NOT_FOUND);
  return await refreshed(deps, got[0]!);
}

async function leave(deps: Deps, i: Interaction, id: string, slotId?: string): Promise<InteractionResponse> {
  const userId = i.member?.user?.id;
  const guildId = i.guild_id;
  if (!userId || !guildId) return reply(INVALID);
  const promoted: Promotion[] = [];
  const result = await leaveContent(deps.sql, { contentId: id, userId, guildId, now: deps.now(), promoted, ...(slotId ? { slotId } : {}) });
  if (result === "not_found") return reply(NOT_FOUND);
  if (result === "not_yours") return reply("That is not your position. Only the player on a row can use its Leave button.");
  if (result === "not_signed") return reply("You are not signed up for this content.");
  if (result === "unavailable") return reply("This content is no longer open, so you cannot leave it.");
  return await refreshed(deps, id, promoted);
}

// The Leave button on a player's own row.
export async function handleLeaveSlot(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  if (isOldRoster(i)) return reply(OLD_LAYOUT);
  const got = ids(i, "leaveslot", 3);
  return got ? await leave(deps, i, got[0]!, got[1]!) : reply(INVALID);
}

// The shared Leave button used on parties of 12 or more positions: it works for anyone who is signed up.
export async function handleLeave(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  if (isOldRoster(i)) return reply(OLD_LAYOUT);
  const got = ids(i, "leave", 2);
  return got ? await leave(deps, i, got[0]!) : reply(INVALID);
}

// Controls of rosters posted before the new layout (menu "signup:", buttons "pick:").
export async function handleOldRosterControl(): Promise<InteractionResponse> {
  return reply(OLD_LAYOUT);
}
