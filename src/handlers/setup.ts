import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { MAX_ADMIN_ROLES, getAdminRoleIds, setAdminRoles } from "../db/settings.ts";
import { hasManageServer, isAdmin } from "../domain/permissions.ts";
import { parseMessageLink } from "../domain/ctamsg.ts";
import { subOption } from "../discord/modal.ts";
import { deleteDashboard, getDashboard, setDashboardChannel, type Dashboard, type DashboardKind } from "../db/dashboard.ts";
import { refreshDashboard } from "../jobs/dashboards.ts";
import { deleteEventForum, forumsOf, getEventForum, listEventForums, saveEventForum, type EventForum, type ForumType } from "../db/eventForum.ts";
import { TYPE_LABEL } from "../domain/kinds.ts";
import { clearChangelogChannel, getChangelogChannel, setChangelogChannel } from "../db/changelog.ts";
import { MAX_CTA_ROLES, clearCtaChannel, clearCtaMessage, getCtaChannel, getCtaMessage, getCtaRoleIds, setCtaChannel, setCtaMessage, setCtaRoles } from "../db/cta.ts";

const SNOWFLAKE = /^\d{5,25}$/;
const NOT_ALLOWED = "Only members with Manage Server can change the admin roles.";

const NOT_ADMIN = "Only an admin (an admin role, Manage Server or Administrator) can change the calendar channel or the event forums.";
const BAD_CHANNEL = "Pick a text or announcement channel of this server.";
const KINDS: { kind: DashboardKind; label: string; set: string; clear: string; what: string }[] = [
  { kind: "schedule", label: "Calendar", set: "calendar-channel", clear: "clear-calendar", what: "the Events Calendar" },
];

// The panel: a role picker with the current admin roles already selected (ADR 0020, owner request 2026-10-08), and the
// channels now in use (FR-043, FR-044).
export type CtaSettings = { channel: string | null; roles: string[]; message?: { channelId: string; messageId: string } | null };

// One line per forum, naming each type it serves (ADR 0037): "#pvp-events · PvP, PvX".
export function forumLines(forums: EventForum[]): string[] {
  const byForum = new Map<string, ForumType[]>();
  for (const f of forums) byForum.set(f.forumId, [...(byForum.get(f.forumId) ?? []), f.type]);
  return [...byForum].map(([id, types]) => `<#${id}> · ${types.map((t) => TYPE_LABEL[t]).join(", ")}`);
}

export function setupPanel(guildId: string, roleIds: string[], dashboards: Dashboard[] = [], forums: EventForum[] = [], changelogChannel: string | null = null, cta: CtaSettings = { channel: null, roles: [] }) {
  const current = roleIds.length ? roleIds.map((r) => `<@&${r}>`).join(" ") : "none yet";
  const channel = (kind: DashboardKind) => {
    const d = dashboards.find((x) => x.kind === kind);
    return d ? `<#${d.channelId}>` : "none";
  };
  return {
    content: [
      "**Admin roles**",
      "Members with these roles can manage any content and the presets, like the content's owner. Members with Manage Server or Administrator always can.",
      `Now: ${current}`,
      `Pick up to ${MAX_ADMIN_ROLES} roles below; the list saves as soon as you change it.`,
      "",
      "**Content-management channel** (the Events Calendar and the creation buttons; admins set it with `calendar-channel`)",
      `Content-management channel: ${channel("schedule")}`,
      "",
      "**Changelog** (admins set it with `changelog-channel`)",
      `Changelog channel: ${changelogChannel ? `<#${changelogChannel}>` : "none"}`,
      "",
      "**Event forums** (admins set them with `event-forum`; normal content is posted in the forum of its type)",
      forums.length ? forumLines(forums).join("\n") : "none",
      "",
      "**CTA (call to arms)** (admins set the text channel with `cta-channel`)",
      `CTA channel: ${cta.channel ? `<#${cta.channel}>` : "none"}`,
      `CTA message: ${cta.message ? `https://discord.com/channels/${guildId}/${cta.message.channelId}/${cta.message.messageId}` : "none"}`,
      `Roles that may schedule a CTA (admins always may): ${cta.roles.length ? cta.roles.map((r) => `<@&${r}>`).join(" ") : "none yet"}`,
    ].join("\n"),
    components: [{
      type: 1,
      components: [{
        type: 6, custom_id: "setup:roles", placeholder: "Choose the admin roles", min_values: 0, max_values: MAX_ADMIN_ROLES,
        default_values: roleIds.map((id) => ({ id, type: "role" })),
      }],
    }, {
      type: 1,
      components: [{
        type: 6, custom_id: "setup:cta", placeholder: "Choose the roles that may schedule a CTA", min_values: 0, max_values: MAX_CTA_ROLES,
        default_values: cta.roles.map((id) => ({ id, type: "role" })),
      }],
    }],
    allowed_mentions: { parse: [] },
  };
}

async function panelOf(deps: Deps, guildId: string) {
  return setupPanel(
    guildId, await getAdminRoleIds(deps.sql, guildId), await dashboardsOf(deps, guildId), await listEventForums(deps.sql, guildId),
    await getChangelogChannel(deps.sql, guildId), { channel: await getCtaChannel(deps.sql, guildId), roles: await getCtaRoleIds(deps.sql, guildId), message: await getCtaMessage(deps.sql, guildId) },
  );
}

async function removeMessages(deps: Deps, d: Dashboard): Promise<void> {
  for (const m of d.messageIds) await deps.rest.deleteMessage(d.channelId, m).catch(() => {});
}

async function dashboardsOf(deps: Deps, guildId: string): Promise<Dashboard[]> {
  const found = await Promise.all(KINDS.map((k) => getDashboard(deps.sql, guildId, k.kind)));
  return found.filter((d): d is Dashboard => d !== null);
}

// Sets, moves or clears the channel of one dashboard. Only the bot's own recorded messages are ever deleted.
async function applyChannel(deps: Deps, guildId: string, k: (typeof KINDS)[number], channelId: string | null): Promise<string> {
  const old = await getDashboard(deps.sql, guildId, k.kind);
  if (channelId === null) {
    if (!old) return `${k.label} was not set.`;
    await removeMessages(deps, old);
    await deleteDashboard(deps.sql, guildId, k.kind);
    return `${k.label} channel cleared: ${k.what} is no longer kept.`;
  }
  if (old && old.channelId !== channelId) await removeMessages(deps, old);
  await setDashboardChannel(deps.sql, { guildId, kind: k.kind, channelId, now: deps.now() });
  if ((await refreshDashboard(deps, guildId, k.kind)) === "failed") {
    await deleteDashboard(deps.sql, guildId, k.kind);
    return `I could not post in <#${channelId}>, so the ${k.label.toLowerCase()} channel was not set. Give the bot View Channel and Send Messages there, then try again.`;
  }
  return `${k.label} channel set to <#${channelId}>: ${k.what} is posted there and kept up to date.`;
}

// What the owner sets once in each event forum (FR-053): members can talk in posts but not make them; the bot can.
export const FORUM_PERMISSIONS = [
  "**Set these permissions in the forum** (Edit Channel → Permissions):",
  "• @everyone: deny **Create Posts**, allow **Send Messages in Posts**.",
  "• The bot's role: allow **Create Posts**, **Send Messages in Posts**, **Manage Threads** and **Pin Messages** (it pins each roster).",
].join("\n");

// Register an event forum (FR-053, changed 2026-11-06 by ADR 0036): normal content is posted in the forum of its type. There
// is no launcher post any more; members create content with the buttons in the content-management channel.
async function applyEventForum(deps: Deps, guildId: string, forumId: string, type: ForumType): Promise<string> {
  for (const old of await forumsOf(deps.sql, guildId, forumId)) {
    if (old.launcherThreadId) await deps.rest.deleteChannel?.(old.launcherThreadId).catch(() => {});
  }
  await saveEventForum(deps.sql, { guildId, forumId, type, launcherThreadId: null });
  const types = (await forumsOf(deps.sql, guildId, forumId)).map((f) => TYPE_LABEL[f.type]).join(", ");
  return [
    `<#${forumId}> is now the event forum for ${TYPE_LABEL[type]} content (it serves: ${types}). Content of that type created with the buttons in the content-management channel is posted there. Run the command again with another \`forum-type\` to use the same forum for more types.`,
    FORUM_PERMISSIONS,
  ].join("\n");
}

// Without a type the forum stops serving every type; with one, only that type.
// Adds and removes one CTA role at a time (a command option holds one role); the panel's picker sets the whole list.
async function applyCtaRoles(deps: Deps, guildId: string, add: unknown, remove: unknown): Promise<string> {
  const now = await getCtaRoleIds(deps.sql, guildId);
  const next = new Set(now);
  if (typeof add === "string") next.add(add);
  if (typeof remove === "string") next.delete(remove);
  if (next.size > MAX_CTA_ROLES) return `A server can have at most ${MAX_CTA_ROLES} CTA roles. Remove one first.`;
  await setCtaRoles(deps.sql, guildId, [...next]);
  const list = next.size ? [...next].map((r) => `<@&${r}>`).join(" ") : "none (only admins)";
  return `CTA roles now: ${list}. Admins can always create a CTA.`;
}

async function clearEventForum(deps: Deps, guildId: string, forumId: string, type: ForumType | null): Promise<string> {
  const old = (await forumsOf(deps.sql, guildId, forumId)).filter((f) => !type || f.type === type);
  if (old.length === 0) return type ? `<#${forumId}> was not the event forum for ${TYPE_LABEL[type]}.` : `<#${forumId}> was not an event forum.`;
  for (const f of old) if (f.launcherThreadId) await deps.rest.deleteChannel?.(f.launcherThreadId).catch(() => {});
  await deleteEventForum(deps.sql, guildId, forumId, type);
  const left = await getEventForum(deps.sql, guildId, forumId);
  return left
    ? `<#${forumId}> no longer takes ${type ? TYPE_LABEL[type] : "those"} content; it still serves other types.`
    : `<#${forumId}> is no longer an event forum. Give members Create Posts again if they should post there.`;
}

export async function handleSetupCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  if (!i.guild_id || !i.member?.user?.id) return reply("Use this command inside the server.");
  const given = KINDS.map((k) => ({ k, channel: subOption(i, "setup", k.set), clear: subOption(i, "setup", k.clear) === true }));
  const forum = subOption(i, "setup", "event-forum");
  const forumType = subOption(i, "setup", "forum-type");
  const clearForum = subOption(i, "setup", "clear-event-forum");
  const forumGiven = forum !== undefined || clearForum !== undefined || forumType !== undefined;
  const ctaRole = subOption(i, "setup", "cta-role");
  const removeCtaRole = subOption(i, "setup", "remove-cta-role");
  const changelog = subOption(i, "setup", "changelog-channel");
  const clearChangelog = subOption(i, "setup", "clear-changelog") === true;
  const changelogGiven = changelog !== undefined || clearChangelog;
  const ctaChannel = subOption(i, "setup", "cta-channel");
  const clearCta = subOption(i, "setup", "clear-cta") === true;
  const ctaMsg = subOption(i, "setup", "cta-msg");
  const clearCtaMsg = subOption(i, "setup", "clear-cta-msg") === true;
  const ctaGiven = ctaChannel !== undefined || clearCta || ctaMsg !== undefined || clearCtaMsg || ctaRole !== undefined || removeCtaRole !== undefined;
  if (given.every((g) => g.channel === undefined && !g.clear) && !forumGiven && !changelogGiven && !ctaGiven) {
    if (!hasManageServer(i.member.permissions)) return reply(NOT_ALLOWED);
    return { type: CHANNEL_MESSAGE, data: { ...(await panelOf(deps, i.guild_id)), flags: EPHEMERAL } };
  }
  const adminRoles = await getAdminRoleIds(deps.sql, i.guild_id);
  if (!isAdmin({ userId: i.member.user.id, roles: i.member.roles ?? [], permissions: i.member.permissions }, adminRoles)) return reply(NOT_ADMIN);
  const resolved = (i.data as { resolved?: { channels?: Record<string, { type?: number }> } } | undefined)?.resolved?.channels ?? {};
  for (const g of given) {
    if (g.channel !== undefined && g.clear) return reply("Give a channel or clear it, not both.");
    if (g.channel !== undefined && (typeof g.channel !== "string" || !SNOWFLAKE.test(g.channel) || ![0, 5].includes(resolved[g.channel]?.type ?? -1))) {
      return reply(BAD_CHANNEL);
    }
  }
  if (changelog !== undefined && clearChangelog) return reply("Give a channel or clear it, not both.");
  if (changelog !== undefined && (typeof changelog !== "string" || !SNOWFLAKE.test(changelog) || ![0, 5, 10, 11, 12, 15].includes(resolved[changelog]?.type ?? -1))) {
    return reply("Pick a text, announcement or forum channel, or a thread or forum post, of this server.");
  }
  const forums = (i.data as { resolved?: { channels?: Record<string, { type?: number }> } } | undefined)?.resolved?.channels ?? {};
  const isForum = (v: unknown): v is string => typeof v === "string" && SNOWFLAKE.test(v) && forums[v]?.type === 15;
  if (forum !== undefined && !isForum(forum)) return reply("Pick a forum channel of this server for `event-forum`.");
  if (clearForum !== undefined && !isForum(clearForum)) return reply("Pick a forum channel of this server for `clear-event-forum`.");
  if (forumType !== undefined && forum === undefined && clearForum === undefined) return reply("`forum-type` goes with `event-forum` or `clear-event-forum`.");
  if (forumType !== undefined && forumType !== "pvp" && forumType !== "pve" && forumType !== "pvx") return reply("Pick PvP, PvE or PvX.");
  if (forum !== undefined && forumType === undefined) return reply("Pick the `forum-type` this forum is for: PvP, PvE or PvX. Run the command again to use the same forum for more types.");
  if (forum !== undefined && clearForum !== undefined) return reply("Set a forum or clear one, not both.");
  const resolvedRoles = (i.data as { resolved?: { roles?: Record<string, unknown> } } | undefined)?.resolved?.roles ?? {};
  for (const [name, role] of [["cta-role", ctaRole], ["remove-cta-role", removeCtaRole]] as const) {
    if (role !== undefined && (typeof role !== "string" || !SNOWFLAKE.test(role) || !(role in resolvedRoles))) return reply(`Pick a role of this server for \`${name}\`.`);
    if (role === i.guild_id) return reply("@everyone cannot be a CTA role. Pick a specific role.");
  }
  if (ctaChannel !== undefined && clearCta) return reply("Give a channel or clear it, not both.");
  if (ctaChannel !== undefined && (typeof ctaChannel !== "string" || !SNOWFLAKE.test(ctaChannel) || ![0, 5].includes(resolved[ctaChannel]?.type ?? -1))) {
    return reply("Pick a text or announcement channel of this server for `cta-channel`.");
  }
  if (ctaMsg !== undefined && clearCtaMsg) return reply("Give a message link or clear it, not both.");
  if (ctaMsg !== undefined && typeof ctaMsg !== "string") return reply("Paste a message link for `cta-msg`.");
  const lines: string[] = [];
  if (typeof ctaMsg === "string") {
    const link = parseMessageLink(ctaMsg, i.guild_id);
    if (!link.ok) return reply(link.error);
    if (!deps.rest.getMessage) return reply("The bot cannot read messages here, so the CTA message was not set.");
    const got = await deps.rest.getMessage(link.value.channelId, link.value.messageId);
    if (!got.ok) return reply("I could not read that message, so the CTA message was not set. Check the link, and give the bot View Channel and Read Message History in that channel.");
    await setCtaMessage(deps.sql, i.guild_id, link.value.channelId, link.value.messageId);
    lines.push("CTA message set: it is copied under every CTA you schedule.");
  } else if (clearCtaMsg) {
    lines.push((await clearCtaMessage(deps.sql, i.guild_id)) ? "CTA message cleared: CTAs no longer carry a copied message." : "The CTA message was not set.");
  }
  if (typeof ctaChannel === "string") {
    await setCtaChannel(deps.sql, i.guild_id, ctaChannel);
    lines.push(`<#${ctaChannel}> is the CTA channel: each CTA you schedule is announced there and gets a thread with its roster. Give the bot View Channel, Send Messages, Create Public Threads, Send Messages in Threads, Manage Threads and Pin Messages in it. Choose who may create CTAs with \`cta-role\`.`);
  } else if (clearCta) {
    lines.push((await clearCtaChannel(deps.sql, i.guild_id)) ? "CTA channel cleared: a CTA cannot be scheduled until you set one." : "No CTA channel was set.");
  }
  if (typeof ctaRole === "string" || typeof removeCtaRole === "string") lines.push(await applyCtaRoles(deps, i.guild_id, ctaRole, removeCtaRole));
  if (isForum(forum) && (forumType === "pvp" || forumType === "pve" || forumType === "pvx")) lines.push(await applyEventForum(deps, i.guild_id, forum, forumType));
  if (isForum(clearForum)) lines.push(await clearEventForum(deps, i.guild_id, clearForum, forumType === "pvp" || forumType === "pve" || forumType === "pvx" ? forumType : null));
  if (typeof changelog === "string") {
    await setChangelogChannel(deps.sql, i.guild_id, changelog);
    const kind = resolved[changelog]?.type;
    const forum = kind === 15;
    lines.push(forum
      ? `Changelog forum set to <#${changelog}>: each release becomes a new post there. Give the bot View Channel, Create Posts and Send Messages in Posts in it.`
      : kind === 10 || kind === 11 || kind === 12
      ? `Changelog thread set to <#${changelog}>: each release's changelog is posted in it. Give the bot View Channel and Send Messages in Posts (or Send Messages in Threads) there.`
      : `Changelog channel set to <#${changelog}>: each release's changelog is posted there. Give the bot View Channel and Send Messages in it.`);
  } else if (clearChangelog) {
    lines.push((await clearChangelogChannel(deps.sql, i.guild_id)) ? "Changelog channel cleared: changelogs are no longer posted here." : "The changelog channel was not set.");
  }
  for (const g of given) {
    if (g.channel !== undefined) lines.push(await applyChannel(deps, i.guild_id, g.k, g.channel as string));
    else if (g.clear) lines.push(await applyChannel(deps, i.guild_id, g.k, null));
  }
  return reply(lines.join("\n"));
}

// The picker's click. The permission is checked again here: a client can send any custom id.
export async function handleSetupComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = (i.data ?? {}) as { custom_id?: unknown; values?: unknown };
  const which = data.custom_id === "setup:roles" ? "roles" : data.custom_id === "setup:cta" ? "cta" : null;
  if (!which || !i.guild_id || !i.member?.user?.id) return reply("That action is not valid. Run `/content setup` again.");
  if (!hasManageServer(i.member.permissions)) return reply(NOT_ALLOWED);
  // Discord always sends an array (empty when every role was unticked); anything else is not a real click.
  if (!Array.isArray(data.values)) return reply("That action is not valid. Run `/content setup` again.");
  const values: unknown[] = data.values;
  if (!values.every((v): v is string => typeof v === "string" && SNOWFLAKE.test(v))) return reply("That role is not valid.");
  const ids = [...new Set(values)];
  if (ids.includes(i.guild_id)) return reply(`@everyone cannot be ${which === "roles" ? "an admin" : "a CTA"} role. Pick specific roles.`);
  const max = which === "roles" ? MAX_ADMIN_ROLES : MAX_CTA_ROLES;
  if (ids.length > max) return reply(`Pick at most ${max} roles.`);
  if (which === "roles") await setAdminRoles(deps.sql, i.guild_id, ids);
  else await setCtaRoles(deps.sql, i.guild_id, ids);
  return { type: UPDATE_MESSAGE, data: await panelOf(deps, i.guild_id) };
}
