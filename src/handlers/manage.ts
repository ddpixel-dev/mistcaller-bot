import { postName } from "../domain/postname.ts";
import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, MODAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { modalValues, textInput } from "../discord/modal.ts";
import { unpackRef } from "../domain/buildref.ts";
import { formProblems } from "./retry.ts";
import { refreshDashboardSoon } from "../jobs/dashboards.ts";
import { utcInput } from "../domain/time.ts";
import { resolveKind } from "../domain/kinds.ts";
import { getAdminRoleIds } from "../db/settings.ts";
import { getRosterView } from "../db/content.ts";
import {
  cancelContent, editContent, getManageTargetById, getManageTargetFor, listUpcoming, lockContent, unlockContent, type ManageTarget,
} from "../db/manage.ts";
import { canManage } from "../domain/permissions.ts";
import { formatSlotLines } from "../domain/slots.ts";
import { parseCtaSlots } from "../domain/parties.ts";
import { parseGearTier, parseNotes, parseSlots, parseTitle, parseUtcStart } from "../domain/parse.ts";
import { escapeText, renderRosterMessage } from "../render/roster.ts";
import { DiscordApiError } from "../discord/rest.ts";
import { announcementBody } from "./ctaannounce.ts";
import { getCtaChannel } from "../db/cta.ts";
import { refreshRosters } from "./rosters.ts";
import { announcePromotions } from "./waitlist.ts";
import type { Promotion } from "../db/signup.ts";
import { TYPE_LABEL, kindDef } from "../domain/kinds.ts";
import type { ContentType } from "../domain/types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_CONTENT = "There is no active content in this post.";
const NOT_ALLOWED = "Only the creator, a member with Manage Server, or an admin role can do that.";
const INVALID = "That action is not valid. Please run the command again.";

type Checked = { ok: true; target: ManageTarget } | { ok: false; response: InteractionResponse };

export async function authorize(deps: Deps, i: Interaction, target: ManageTarget | null): Promise<Checked> {
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

// The content a host action is for. A Manage panel button carries it (`mg:<action>:<content>`), which is how a panel
// opened from a CTA roster in the CTA channel finds it (ADR 0047); getManageTargetFor accepts it only in the verified
// guild and in a channel the content owns. Without one (a command in a post) it is the post's content.
export async function targetOf(deps: Deps, i: Interaction): Promise<ManageTarget | null> {
  if (!i.guild_id || !i.channel?.id) return null;
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const p = typeof raw === "string" ? raw.split(":") : [];
  const contentId = p[0] === "mg" && p.length === 3 ? p[2] : undefined;
  return await getManageTargetFor(deps.sql, i.guild_id, i.channel.id, contentId);
}

export async function refreshRoster(deps: Deps, id: string): Promise<boolean> {
  try {
    const view = await getRosterView(deps.sql, id, deps.now());
    if (!view?.messageId) return false;
    await refreshRosters(deps, view, { strict: true });
    return true;
  } catch (err) {
    console.error(JSON.stringify({ evt: "roster_refresh_failed", name: err instanceof Error ? err.name : "unknown" }));
    return false;
  }
}

export async function announce(deps: Deps, threadId: string, text: string, users: string[], components?: unknown[]): Promise<void> {
  try {
    await deps.rest.createMessage(threadId, { content: text, allowed_mentions: { users }, ...(components ? { components } : {}) });
  } catch (err) {
    console.error(JSON.stringify({ evt: "announce_failed", name: err instanceof Error ? err.name : "unknown" }));
  }
}

const mentions = (users: string[]) => users.map((u) => `<@${u}>`).join(" ");

// Edit details (the Manage panel's Edit, then Edit details): the form with the event's current text. The category,
// loot vote and build reference are changed in the Edit panel (ADR 0029), so the form id keeps them ("k").
export async function openEditForm(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const target = await targetOf(deps, i);
  const checked = await authorize(deps, i, target);
  if (!checked.ok) return checked.response;
  if (checked.target.status !== "open") return reply("Only open content can be edited. Locked, finished or cancelled content cannot.");
  const view = await getRosterView(deps.sql, checked.target.id, deps.now());
  if (!view) return reply(NO_CONTENT);
  return {
    type: MODAL,
    data: {
      custom_id: `edit:${view.id}:k`,
      title: "Edit content",
      components: [
        textInput("title", "Title", 100, { value: view.title }),
        textInput("start", "Start time (UTC, YYYY-MM-DD HH:mm)", 20, { value: utcInput(view.startsAt) }),
        textInput("tier", "Gear Tier", 80, { value: view.tier }),
        // A blank content has no slots (FR-060); its notes are the description.
        ...(view.blank ? [] : [textInput(
          "slots", view.partyCount === 2 ? "Party 1 slots" : "Slots (one per line: Role - Weapon)", 1500,
          { style: 2, value: formatSlotLines(view.slots.filter((s) => s.party === 1)) },
        )]),
        textInput("notes", view.blank ? "Description (optional)" : "Notes (optional)", 500, { required: false, ...(view.notes ? { value: view.notes } : {}) }),
      ],
    },
  };
}

// The form id may still carry a category and a build marker from forms opened before 0.23.0.
export async function handleEditModal(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const customId = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const parts = typeof customId === "string" ? customId.split(":") : [];
  if (parts.length < 3 || parts.length > 5 || !UUID.test(parts[1]!) || !["1", "0", "k"].includes(parts[2]!)) {
    return reply(INVALID);
  }
  const checked = await authorize(deps, i, await getManageTargetById(deps.sql, parts[1]!));
  if (!checked.ok) return checked.response;
  let kindId: string | null = null;
  if (parts[3] !== undefined && parts[3] !== "-") {
    const typeRow = await getRosterView(deps.sql, checked.target.id, deps.now());
    const kind = resolveKind(typeRow?.type ?? "pvp", parts[3]);
    if (!kind.ok) return reply(kind.error);
    kindId = kind.value;
  }

  const marker = parts[4];
  const markedRef = marker !== undefined && marker !== "bx" && marker.startsWith("b") ? unpackRef(marker.slice(1)) : null;
  if (marker !== undefined && marker !== "bx" && markedRef === null) return reply(INVALID);
  const buildRef: string | null | undefined = marker === undefined ? undefined : marker === "bx" ? null : markedRef;

  const v = modalValues(i);
  const title = parseTitle(v.title ?? "");
  const tier = parseGearTier(v.tier ?? "");
  const current = await getRosterView(deps.sql, checked.target.id, deps.now());
  const isBlank = current?.blank === true;
  // Content stays live after its start (FR-024) and the form is prefilled with the current start, so an unchanged start
  // is accepted even when it is already past. Only a new start must be in the future (ADR 0024).
  const start = current && (v.start ?? "").trim() === utcInput(current.startsAt)
    ? ({ ok: true, value: current.startsAt } as ReturnType<typeof parseUtcStart>)
    : parseUtcStart(v.start ?? "", deps.now());
  const slots = isBlank ? ({ ok: true, value: [] } as ReturnType<typeof parseSlots>) : (current?.cta ? parseCtaSlots(v.slots ?? "", 1, current.partyCount, current.slots.filter((s) => s.party === 1)) : parseSlots(v.slots ?? ""));
  const notes = parseNotes(v.notes ?? "");
  // Every mistake at once, with a button that reopens the form filled in (ADR 0025).
  if (!title.ok || !start.ok || !tier.ok || !slots.ok || !notes.ok) {
    return await formProblems(deps, i, String(customId), [title, start, tier, slots, notes].flatMap((r) => (r.ok ? [] : [r.error])));
  }

  const result = await editContent(deps.sql, checked.target.id, {
    title: title.value, notes: notes.value, startsAt: start.value, tier: tier.value,
    hasLoot: parts[2] === "k" ? null : parts[2] === "1", kind: kindId, slots: slots.value,
    ...(buildRef !== undefined ? { buildRef } : {}),
  }, deps.now());
  if (result.result === "unavailable") return reply("This content can no longer be edited. It may have been locked, ended or cancelled.");
  if (result.result === "slots_held") return await formProblems(deps, i, String(customId), [result.error]);

  const refreshed = await refreshRoster(deps, checked.target.id);
  await refreshDashboardSoon(deps, checked.target.guildId, "schedule");
  // A post the bot made is named after the event, so it follows the title and the start (ADR 0032, ADR 0042). Discord
  // allows two renames per ten minutes per post; a refusal leaves the old name and says so.
  let renameNote = "";
  if (checked.target.ownPost && (title.value !== checked.target.title || result.startChanged) && deps.rest.editChannel) {
    try {
      await deps.rest.editChannel(checked.target.threadId, { name: postName(title.value, start.value) });
    } catch {
      renameNote = " The post keeps its old name for now: Discord allows two renames every 10 minutes. Edit again later to rename it.";
    }
  }
  // A CTA's one-line announcement is the message the thread was started from, so it has the thread's id.
  if (current?.cta && (title.value !== checked.target.title || result.startChanged)) {
    try {
      const channel = await getCtaChannel(deps.sql, checked.target.guildId);
      if (channel) {
        await deps.rest.editMessage(channel, checked.target.threadId, announcementBody(title.value, start.value, { guildId: checked.target.guildId, threadId: checked.target.threadId, messageId: current.messageId }));
      }
    } catch (e) {
      console.error(JSON.stringify({ evt: "announcement_edit_failed", name: e instanceof Error ? e.name : "unknown", ...(e instanceof DiscordApiError ? { status: e.status, code: e.code } : {}) }));
    }
  }
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
  return reply((refreshed ? "Content updated." : "Content updated, but the roster message could not be refreshed. It will update on the next change.") + renameNote);
}

export async function handleCancel(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const target = await targetOf(deps, i);
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
  await refreshDashboardSoon(deps, checked.target.guildId, "schedule");
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

// "/content lock": close signups now (FR-009). Players can still leave.
export async function handleLock(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const target = await targetOf(deps, i);
  const checked = await authorize(deps, i, target);
  if (!checked.ok) return checked.response;
  const result = await lockContent(deps.sql, checked.target.id);
  if (result === "unavailable") {
    return reply(checked.target.status === "locked" ? "This roster is already locked." : "Only open content can be locked.");
  }
  const refreshed = await refreshRoster(deps, checked.target.id);
  return reply(`Roster locked: signups and moves are closed, and players can still leave.${refreshed ? "" : " The roster message will update on the next change."}`);
}

// "/content unlock": reopen a roster that was locked by hand. Works before and after the start.
export async function handleUnlock(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const target = await targetOf(deps, i);
  const checked = await authorize(deps, i, target);
  if (!checked.ok) return checked.response;
  const result = await unlockContent(deps.sql, checked.target.id, deps.now());
  if (result.result === "unavailable") return reply(checked.target.status === "open" ? "This roster is not locked." : "Only a locked roster can be unlocked.");
  const refreshed = await refreshRoster(deps, checked.target.id);
  const view = await getRosterView(deps.sql, checked.target.id, deps.now());
  await announcePromotions(deps, checked.target.threadId, view?.title ?? "", result.promoted);
  return reply(`Roster unlocked: signups and moves are open again.${refreshed ? "" : " The roster message will update on the next change."}`);
}

const LIST_LIMIT = 15;

// "/content list": live and upcoming content of this server with links (FR-015).
export async function handleListCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  if (!i.guild_id) return reply("Use this command inside the server.");
  const items = await listUpcoming(deps.sql, i.guild_id, LIST_LIMIT + 1);
  if (items.length === 0) return reply("No live or upcoming content. Start one with **Plan Content** in the content-management channel.");
  const lines = items.slice(0, LIST_LIMIT).map((c) => {
    const epoch = Math.floor(c.startsAt.getTime() / 1000);
    const def = kindDef(c.type as ContentType, c.kind);
    const kind = `${TYPE_LABEL[c.type as ContentType]}${def && def.id !== "other" ? ` · ${def.label}` : ""}`;
    const link = c.messageId ? `https://discord.com/channels/${i.guild_id}/${c.threadId}/${c.messageId}` : `https://discord.com/channels/${i.guild_id}/${c.threadId}`;
    const title = escapeText(Array.from(c.title).slice(0, 60).join(""));
    return `<t:${epoch}:R> · **${title}** · ${kind} · ${c.filled}/${c.total}${c.status === "locked" ? " 🔒" : ""}\n${link}`;
  });
  const more = items.length > LIST_LIMIT ? `\n…and more. Showing the next ${LIST_LIMIT}.` : "";
  return reply(`📅 **Live and upcoming content**\n${lines.join("\n")}${more}`.slice(0, 2000));
}

// edp:<content>: the Edit party 2 slots form. Only party 2's lines change; every other field keeps its current value and
// party 1 is left as it is. Party 2's holders keep their slots (planSlotEdit), and a held slot cannot be removed.
export async function handleParty2Modal(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const customId = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const parts = typeof customId === "string" ? customId.split(":") : [];
  if (parts.length !== 2 || parts[0] !== "edp" || !UUID.test(parts[1]!)) return reply(INVALID);
  const checked = await authorize(deps, i, await getManageTargetById(deps.sql, parts[1]!));
  if (!checked.ok) return checked.response;
  const view = await getRosterView(deps.sql, checked.target.id, deps.now());
  if (!view || view.partyCount !== 2) return reply(INVALID);
  const slots2 = parseCtaSlots(modalValues(i).slots ?? "", 2, 2, view.slots.filter((s) => s.party === 2));
  if (!slots2.ok) return await formProblems(deps, i, String(customId), [slots2.error]);
  const result = await editContent(deps.sql, view.id, {
    hasLoot: null, kind: null, slots2: slots2.value,
  }, deps.now());
  if (result.result === "unavailable") return reply("This content can no longer be edited. It may have been locked, ended or cancelled.");
  if (result.result === "slots_held") return await formProblems(deps, i, String(customId), [result.error]);
  const refreshed = await refreshRoster(deps, view.id);
  await announcePromotions(deps, checked.target.threadId, view.title, result.promoted);
  return reply(refreshed ? "Party 2 updated." : "Party 2 updated, but a roster message could not be refreshed. It will update on the next change.");
}
