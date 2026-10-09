import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { getRosterView } from "../db/content.ts";
import { getManageTarget } from "../db/manage.ts";
import { claimSlot, leaveContent, type Promotion } from "../db/signup.ts";
import { announcePromotions } from "./waitlist.ts";
import type { RosterView } from "../domain/types.ts";
import { escapeText, renderRosterMessage } from "../render/roster.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = "This content or position no longer exists.";
const INVALID = "That panel is out of date. Run `/content me` again.";

// A private panel only for the member who opened it, so its Leave button is theirs alone.
export function renderMePanel(view: RosterView, userId: string) {
  const mine = view.slots.find((s) => s.userId === userId) ?? null;
  const isFill = (view.fills ?? []).includes(userId);
  const open = view.status === "open";
  const lines = [`**${escapeText(view.title)}**`];
  lines.push(
    mine
      ? `You are signed up as ${mine.position}. ${escapeText(mine.role)}${mine.weapon || mine.chosenWeapon ? ` - ${escapeText(mine.weapon || mine.chosenWeapon!)}` : ""}.`
      : isFill ? "You are signed up as a fill: the owner places you in a position."
      : "You are not signed up.",
  );
  if (!open) lines.push("Signups and moves are closed.");
  const rows: unknown[] = [];
  if (open) {
    rows.push({
      type: 1,
      components: [{
        type: 3, custom_id: `me:pick:${view.id}`, placeholder: mine ? "Move to another position" : "Sign up for a position",
        options: view.slots.map((s) => ({
          label: Array.from(`${s.position}. ${s.role}${s.weapon ? ` - ${s.weapon}` : ""}`).slice(0, 100).join(""),
          value: s.id,
          description: s.userId === userId ? "You are here" : s.userId ? "Taken" : "Open",
        })),
      }],
    });
  }
  const live = view.status === "open" || view.status === "locked";
  const buttons: unknown[] = [{
    type: 2, style: 4, label: "Leave", emoji: { name: "🚪" }, custom_id: `me:leave:${view.id}`,
    disabled: !(live && (mine || isFill)),
  }];
  // A position without a weapon: the holder can pick or change their own (FR-030).
  if (live && mine && !mine.weapon) buttons.push({ type: 2, style: 2, label: "Change weapon", emoji: { name: "⚔️" }, custom_id: `wp:open:${view.id}` });
  rows.push({ type: 1, components: buttons });
  return { content: lines.join("\n"), components: rows, allowed_mentions: { parse: [] as [] } };
}

export async function handleMeCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const userId = i.member?.user?.id;
  if (!i.guild_id || !userId || !i.channel?.id) return reply("Use this command inside a content post.");
  const target = await getManageTarget(deps.sql, i.guild_id, i.channel.id);
  const view = target ? await getRosterView(deps.sql, target.id, deps.now()) : null;
  if (!view) return reply("There is no active content in this post.");
  return { type: CHANNEL_MESSAGE, data: { ...renderMePanel(view, userId), flags: EPHEMERAL } };
}

// The shared roster is edited through the API; a failed edit never undoes the change.
async function refresh(deps: Deps, id: string, userId: string, promoted: Promotion[] = []): Promise<InteractionResponse> {
  const view = await getRosterView(deps.sql, id, deps.now());
  if (!view) return reply(NOT_FOUND);
  await announcePromotions(deps, view.threadId, view.title, promoted);
  try {
    if (view.messageId) await deps.rest.editMessage(view.threadId, view.messageId, renderRosterMessage(view));
  } catch (err) {
    console.error(JSON.stringify({ evt: "roster_refresh_failed", name: err instanceof Error ? err.name : "unknown" }));
  }
  return { type: UPDATE_MESSAGE, data: renderMePanel(view, userId) };
}

export async function handleMeComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = i.data as { custom_id?: unknown; values?: unknown } | undefined;
  const [prefix, action, id, extra] = typeof data?.custom_id === "string" ? data.custom_id.split(":") : [];
  const userId = i.member?.user?.id;
  const guildId = i.guild_id;
  if (prefix !== "me" || !id || extra !== undefined || !UUID.test(id) || !userId || !guildId) return reply(INVALID);

  if (action === "leave") {
    const promoted: Promotion[] = [];
    const result = await leaveContent(deps.sql, { contentId: id, userId, guildId, now: deps.now(), promoted });
    if (result === "not_found") return reply(NOT_FOUND);
    if (result === "not_signed") return reply("You are not signed up for this content.");
    if (result === "unavailable") return reply("This content is no longer open, so you cannot leave it.");
    return await refresh(deps, id, userId, promoted);
  }
  if (action === "pick") {
    const values = data?.values;
    const slotId = Array.isArray(values) && values.length === 1 ? values[0] : undefined;
    if (typeof slotId !== "string" || !UUID.test(slotId)) return reply(INVALID);
    const promoted: Promotion[] = [];
    const result = await claimSlot(deps.sql, { contentId: id, slotId, userId, guildId, now: deps.now(), promoted });
    if (result === "unchanged") return reply("You already hold this position.");
    if (result === "taken") return reply("That position is already taken. Pick another one.");
    if (result === "locked") return reply("Signups are locked for this content.");
    if (result === "not_found") return reply(NOT_FOUND);
    return await refresh(deps, id, userId, promoted);
  }
  return reply(INVALID);
}
