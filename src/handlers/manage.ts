import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, MODAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { modalValues, subOption, textInput } from "../discord/modal.ts";
import { resolveKind } from "../domain/kinds.ts";
import { getAdminRoleIds } from "../db/settings.ts";
import { getRosterView } from "../db/content.ts";
import {
  cancelContent, editContent, getManageTarget, getManageTargetById, listUpcoming, lockContent, unlockContent, type ManageTarget,
} from "../db/manage.ts";
import { canManage } from "../domain/permissions.ts";
import { formatSlotLines } from "../domain/slots.ts";
import { formatTier, parseNotes, parseSlots, parseTier, parseTitle, parseUtcStart } from "../domain/parse.ts";
import { escapeText, renderRosterMessage } from "../render/roster.ts";
import { announcePromotions } from "./waitlist.ts";
import type { Promotion } from "../db/signup.ts";
import { kindDef } from "../domain/kinds.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_CONTENT = "There is no active content in this post.";
const NOT_ALLOWED = "Only the creator, a member with Manage Server, or an admin role can do that.";
const INVALID = "That action is not valid. Please run the command again.";

type Checked = { ok: true; target: ManageTarget } | { ok: false; response: InteractionResponse };

async function authorize(deps: Deps, i: Interaction, target: ManageTarget | null): Promise<Checked> {
  const userId = i.member?.user?.id;
  if (!target || !i.guild_id || target.guildId !== i.guild_id || !userId) {
    return { ok: false, response: reply(NO_CONTENT) };
  }
  const adminRoles = await getAdminRoleIds(deps.sql, i.guild_id);
  const allowed = canManage(
    { userId, roles: i.member?.roles ?? [], permissions: i.member?.permissions },
    { createdBy: target.createdBy },
    adminRoles,
  );
  return allowed ? { ok: true, target } : { ok: false, response: reply(NOT_ALLOWED) };
}

async function refreshRoster(deps: Deps, id: string): Promise<boolean> {
  try {
    const view = await getRosterView(deps.sql, id, deps.now());
    if (!view?.messageId) return false;
    await deps.rest.editMessage(view.threadId, view.messageId, renderRosterMessage(view));
    return true;
  } catch (err) {
    console.error(JSON.stringify({ evt: "roster_refresh_failed", name: err instanceof Error ? err.name : "unknown" }));
    return false;
  }
}

async function announce(deps: Deps, threadId: string, text: string, users: string[]): Promise<void> {
  try {
    await deps.rest.createMessage(threadId, { content: text, allowed_mentions: { users } });
  } catch (err) {
    console.error(JSON.stringify({ evt: "announce_failed", name: err instanceof Error ? err.name : "unknown" }));
  }
}

const mentions = (users: string[]) => users.map((u) => `<@${u}>`).join(" ");
const pad = (n: number) => String(n).padStart(2, "0");
const utcInput = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

function lootOption(i: Interaction): "1" | "0" | "k" {
  const v = subOption(i, "edit", "loot-vote");
  return v === true ? "1" : v === false ? "0" : "k";
}

export async function handleEditCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const target = i.guild_id && i.channel?.id ? await getManageTarget(deps.sql, i.guild_id, i.channel.id) : null;
  const checked = await authorize(deps, i, target);
  if (!checked.ok) return checked.response;
  if (checked.target.status !== "open") return reply("Only open content can be edited. Locked, finished or cancelled content cannot.");
  const view = await getRosterView(deps.sql, checked.target.id, deps.now());
  if (!view) return reply(NO_CONTENT);
  const kindOpt = subOption(i, "edit", "category");
  const kind = typeof kindOpt === "string" ? resolveKind(view.type, kindOpt) : null;
  if (kind && !kind.ok) return reply(kind.error);
  return {
    type: MODAL,
    data: {
      custom_id: `edit:${view.id}:${lootOption(i)}${kind ? `:${kind.value}` : ""}`,
      title: "Edit content",
      components: [
        textInput("title", "Title", 100, { value: view.title }),
        textInput("start", "Start time (UTC, YYYY-MM-DD HH:mm)", 20, { value: utcInput(view.startsAt) }),
        textInput("tier", "Tier", 30, { value: formatTier(view.tier).replace("–", "-") }),
        textInput("slots", "Slots (one per line: Role - Weapon)", 1500, { style: 2, value: formatSlotLines(view.slots) }),
        textInput("notes", "Notes (optional)", 500, { required: false, ...(view.notes ? { value: view.notes } : {}) }),
      ],
    },
  };
}

export async function handleEditModal(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const customId = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const parts = typeof customId === "string" ? customId.split(":") : [];
  if (parts.length < 3 || parts.length > 4 || !UUID.test(parts[1]!) || !["1", "0", "k"].includes(parts[2]!)) {
    return reply(INVALID);
  }
  const checked = await authorize(deps, i, await getManageTargetById(deps.sql, parts[1]!));
  if (!checked.ok) return checked.response;
  let kindId: string | null = null;
  if (parts[3] !== undefined) {
    const typeRow = await getRosterView(deps.sql, checked.target.id, deps.now());
    const kind = resolveKind(typeRow?.type ?? "pvp", parts[3]);
    if (!kind.ok) return reply(kind.error);
    kindId = kind.value;
  }

  const v = modalValues(i);
  const title = parseTitle(v.title ?? "");
  if (!title.ok) return reply(title.error);
  const start = parseUtcStart(v.start ?? "", deps.now());
  if (!start.ok) return reply(start.error);
  const tier = parseTier(v.tier ?? "");
  if (!tier.ok) return reply(tier.error);
  const slots = parseSlots(v.slots ?? "");
  if (!slots.ok) return reply(slots.error);
  const notes = parseNotes(v.notes ?? "");
  if (!notes.ok) return reply(notes.error);

  const result = await editContent(deps.sql, checked.target.id, {
    title: title.value, notes: notes.value, startsAt: start.value, tier: tier.value,
    hasLoot: parts[2] === "k" ? null : parts[2] === "1", kind: kindId, slots: slots.value,
  }, deps.now());
  if (result.result === "unavailable") return reply("This content can no longer be edited. It may have started, been locked or been cancelled.");
  if (result.result === "slots_held") return reply(result.error);

  const refreshed = await refreshRoster(deps, checked.target.id);
  if (result.startChanged && result.notify.length > 0) {
    const epoch = Math.floor(start.value.getTime() / 1000);
    await announce(
      deps,
      checked.target.threadId,
      `${escapeText(title.value)} now starts <t:${epoch}:F> (<t:${epoch}:R>). ${mentions(result.notify)}`,
      result.notify,
    );
  }
  await announcePromotions(deps, checked.target.threadId, title.value, result.promoted);
  return reply(refreshed ? "Content updated." : "Content updated, but the roster message could not be refreshed. It will update on the next change.");
}

export async function handleCancelCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const target = i.guild_id && i.channel?.id ? await getManageTarget(deps.sql, i.guild_id, i.channel.id) : null;
  const checked = await authorize(deps, i, target);
  if (!checked.ok) return checked.response;
  if (checked.target.status !== "open" && checked.target.status !== "locked") {
    return reply("Finished content cannot be cancelled.");
  }
  const id = checked.target.id;
  return {
    type: CHANNEL_MESSAGE,
    data: {
      content: "Cancel this content? The roster is closed and everyone signed up is notified. This cannot be undone.",
      flags: EPHEMERAL,
      allowed_mentions: { parse: [] },
      components: [{
        type: 1,
        components: [
          { type: 2, style: 4, label: "Cancel content", custom_id: `cancelyes:${id}` },
          { type: 2, style: 2, label: "Keep it", custom_id: `cancelno:${id}` },
        ],
      }],
    },
  };
}

const done = (content: string): InteractionResponse => ({
  type: UPDATE_MESSAGE,
  data: { content, components: [], allowed_mentions: { parse: [] } },
});

export async function handleCancelButton(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const customId = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const [prefix, id, extra] = typeof customId === "string" ? customId.split(":") : [];
  if (!id || extra !== undefined || !UUID.test(id) || (prefix !== "cancelyes" && prefix !== "cancelno")) {
    return reply(INVALID);
  }
  if (prefix === "cancelno") return done("Nothing changed.");
  const checked = await authorize(deps, i, await getManageTargetById(deps.sql, id));
  if (!checked.ok) return checked.response;
  const result = await cancelContent(deps.sql, id);
  if (result.result === "unavailable") return done("This content is already cancelled or finished.");
  await refreshRoster(deps, id);
  if (result.notify.length > 0) {
    const view = await getRosterView(deps.sql, id, deps.now());
    await announce(
      deps,
      checked.target.threadId,
      `${escapeText(view?.title ?? "This content")} was cancelled. ${mentions(result.notify)}`,
      result.notify,
    );
  }
  return done("Content cancelled.");
}

// "/content lock": close signups now instead of at the start (FR-009). Players can still leave.
export async function handleLockCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const target = i.guild_id && i.channel?.id ? await getManageTarget(deps.sql, i.guild_id, i.channel.id) : null;
  const checked = await authorize(deps, i, target);
  if (!checked.ok) return checked.response;
  const result = await lockContent(deps.sql, checked.target.id, deps.now());
  if (result === "started") return reply("The content has already started, so signups are closed.");
  if (result === "unavailable") {
    return reply(checked.target.status === "locked" ? "This roster is already locked." : "Only open content can be locked.");
  }
  const refreshed = await refreshRoster(deps, checked.target.id);
  return reply(`Roster locked: signups and moves are closed, and players can still leave.${refreshed ? "" : " The roster message will update on the next change."}`);
}

// "/content unlock": reopen a roster that was locked early. Not possible once the content has started.
export async function handleUnlockCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const target = i.guild_id && i.channel?.id ? await getManageTarget(deps.sql, i.guild_id, i.channel.id) : null;
  const checked = await authorize(deps, i, target);
  if (!checked.ok) return checked.response;
  const result = await unlockContent(deps.sql, checked.target.id, deps.now());
  if (result.result === "started") return reply("The content has already started, so signups stay closed.");
  if (result.result === "unavailable") return reply(checked.target.status === "open" ? "This roster is not locked." : "Only a locked roster can be unlocked.");
  const refreshed = await refreshRoster(deps, checked.target.id);
  const view = await getRosterView(deps.sql, checked.target.id, deps.now());
  await announcePromotions(deps, checked.target.threadId, view?.title ?? "", result.promoted);
  return reply(`Roster unlocked: signups and moves are open again.${refreshed ? "" : " The roster message will update on the next change."}`);
}

const LIST_LIMIT = 15;

// "/content list": upcoming content of this server with links (FR-015).
export async function handleListCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  if (!i.guild_id) return reply("Use this command inside the server.");
  const items = await listUpcoming(deps.sql, i.guild_id, deps.now(), LIST_LIMIT + 1);
  if (items.length === 0) return reply("No upcoming content. Start one with `/content create` in a channel or post.");
  const lines = items.slice(0, LIST_LIMIT).map((c) => {
    const epoch = Math.floor(c.startsAt.getTime() / 1000);
    const def = kindDef(c.type === "pve" ? "pve" : "pvp", c.kind);
    const kind = `${c.type === "pve" ? "PvE" : "PvP"}${def && def.id !== "other" ? ` · ${def.label}` : ""}`;
    const link = c.messageId ? `https://discord.com/channels/${i.guild_id}/${c.threadId}/${c.messageId}` : `https://discord.com/channels/${i.guild_id}/${c.threadId}`;
    const title = escapeText(Array.from(c.title).slice(0, 60).join(""));
    return `<t:${epoch}:R> · **${title}** · ${kind} · ${c.filled}/${c.total}${c.status === "locked" ? " 🔒" : ""}\n${link}`;
  });
  const more = items.length > LIST_LIMIT ? `\n…and more. Showing the next ${LIST_LIMIT}.` : "";
  return reply(`📅 **Upcoming content**\n${lines.join("\n")}${more}`.slice(0, 2000));
}
