import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { MAX_ADMIN_ROLES, getAdminRoleIds, setAdminRoles } from "../db/settings.ts";
import { hasManageServer, isAdmin } from "../domain/permissions.ts";
import { subOption } from "../discord/modal.ts";
import { deleteDashboard, getDashboard, setDashboardChannel, type Dashboard, type DashboardKind } from "../db/dashboard.ts";
import { refreshDashboard } from "../jobs/dashboards.ts";
import { deleteEventForum, getEventForum, listEventForums, saveEventForum, type EventForum } from "../db/eventForum.ts";
import { LAUNCHER_NAME, renderLauncher } from "../render/card.ts";
import { TYPE_LABEL } from "../domain/kinds.ts";

const SNOWFLAKE = /^\d{5,25}$/;
const NOT_ALLOWED = "Only members with Manage Server can change the admin roles.";

const NOT_ADMIN = "Only an admin (an admin role, Manage Server or Administrator) can change the calendar channel or the event forums.";
const BAD_CHANNEL = "Pick a text or announcement channel of this server.";
const KINDS: { kind: DashboardKind; label: string; set: string; clear: string; what: string }[] = [
  { kind: "schedule", label: "Calendar", set: "calendar-channel", clear: "clear-calendar", what: "the Events Calendar" },
];

// The panel: a role picker with the current admin roles already selected (ADR 0020, owner request 2026-10-08), and the
// channels now in use (FR-043, FR-044).
export function setupPanel(roleIds: string[], dashboards: Dashboard[] = [], forums: EventForum[] = []) {
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
      "**Events Calendar** (admins set it with the options of this command)",
      `Calendar channel: ${channel("schedule")}`,
      "",
      "**Event forums** (admins set them with `event-forum`)",
      forums.length ? forums.map((f) => `<#${f.forumId}> · ${f.type ? TYPE_LABEL[f.type] : "Any type"}`).join("\n") : "none",
    ].join("\n"),
    components: [{
      type: 1,
      components: [{
        type: 6, custom_id: "setup:roles", placeholder: "Choose the admin roles", min_values: 0, max_values: MAX_ADMIN_ROLES,
        default_values: roleIds.map((id) => ({ id, type: "role" })),
      }],
    }],
    allowed_mentions: { parse: [] },
  };
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
  "• The bot's role: allow **Create Posts**, **Send Messages in Posts** and **Manage Threads**.",
].join("\n");

// Register an event forum (FR-053): replace its launcher post, post a new one and pin it.
async function applyEventForum(deps: Deps, guildId: string, forumId: string, type: "pvp" | "pve" | null): Promise<string> {
  if (!deps.rest.createForumPost) return "Event forums are not available right now.";
  const old = await getEventForum(deps.sql, guildId, forumId);
  if (old?.launcherThreadId) await deps.rest.deleteChannel?.(old.launcherThreadId).catch(() => {});
  let postId: string;
  try {
    postId = (await deps.rest.createForumPost(forumId, { name: LAUNCHER_NAME, message: renderLauncher() })).id;
  } catch {
    if (old) await deleteEventForum(deps.sql, guildId, forumId);
    return `I could not create the Create event post in <#${forumId}>, so it is not an event forum.\n${FORUM_PERMISSIONS}\nThen run this again.`;
  }
  // Pinned, it stays at the top of the forum (thread flag PINNED); locked, only Manage Threads can write in it, while
  // anyone can still press its button (ADR 0033). Both need Manage Threads.
  const pinned = await deps.rest.editChannel?.(postId, { flags: 2, locked: true }).then(() => true, () => false);
  await saveEventForum(deps.sql, { guildId, forumId, type, launcherThreadId: postId });
  return [
    `<#${forumId}> is an event forum (${type ? TYPE_LABEL[type] : "any type"}): its **Create event** post is <#${postId}>.`,
    ...(pinned ? [] : ["⚠️ I could not pin and lock it. Give the bot Manage Threads in the forum, then run this again."]),
    FORUM_PERMISSIONS,
    "**Optional:** add this line to the forum's **Post Guidelines** (Edit Channel → Overview), so the button is one click away:",
    `\`To create an event, open <#${postId}>\``,
  ].join("\n");
}

async function clearEventForum(deps: Deps, guildId: string, forumId: string): Promise<string> {
  const old = await getEventForum(deps.sql, guildId, forumId);
  if (!old) return `<#${forumId}> was not an event forum.`;
  if (old.launcherThreadId) await deps.rest.deleteChannel?.(old.launcherThreadId).catch(() => {});
  await deleteEventForum(deps.sql, guildId, forumId);
  return `<#${forumId}> is no longer an event forum, and its Create event post is removed. Give members Create Posts again if they should post there.`;
}

export async function handleSetupCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  if (!i.guild_id || !i.member?.user?.id) return reply("Use this command inside the server.");
  const given = KINDS.map((k) => ({ k, channel: subOption(i, "setup", k.set), clear: subOption(i, "setup", k.clear) === true }));
  const forum = subOption(i, "setup", "event-forum");
  const forumType = subOption(i, "setup", "forum-type");
  const clearForum = subOption(i, "setup", "clear-event-forum");
  const forumGiven = forum !== undefined || clearForum !== undefined || forumType !== undefined;
  if (given.every((g) => g.channel === undefined && !g.clear) && !forumGiven) {
    if (!hasManageServer(i.member.permissions)) return reply(NOT_ALLOWED);
    const roles = await getAdminRoleIds(deps.sql, i.guild_id);
    return { type: CHANNEL_MESSAGE, data: { ...setupPanel(roles, await dashboardsOf(deps, i.guild_id), await listEventForums(deps.sql, i.guild_id)), flags: EPHEMERAL } };
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
  const forums = (i.data as { resolved?: { channels?: Record<string, { type?: number }> } } | undefined)?.resolved?.channels ?? {};
  const isForum = (v: unknown): v is string => typeof v === "string" && SNOWFLAKE.test(v) && forums[v]?.type === 15;
  if (forum !== undefined && !isForum(forum)) return reply("Pick a forum channel of this server for `event-forum`.");
  if (clearForum !== undefined && !isForum(clearForum)) return reply("Pick a forum channel of this server for `clear-event-forum`.");
  if (forumType !== undefined && forum === undefined) return reply("`forum-type` goes with `event-forum`.");
  if (forumType !== undefined && forumType !== "any" && forumType !== "pvp" && forumType !== "pve") return reply("Pick Any, PvP or PvE.");
  const lines: string[] = [];
  if (isForum(forum)) lines.push(await applyEventForum(deps, i.guild_id, forum, forumType === "pvp" || forumType === "pve" ? forumType : null));
  if (isForum(clearForum)) lines.push(await clearEventForum(deps, i.guild_id, clearForum));
  for (const g of given) {
    if (g.channel !== undefined) lines.push(await applyChannel(deps, i.guild_id, g.k, g.channel as string));
    else if (g.clear) lines.push(await applyChannel(deps, i.guild_id, g.k, null));
  }
  return reply(lines.join("\n"));
}

// The picker's click. The permission is checked again here: a client can send any custom id.
export async function handleSetupComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = (i.data ?? {}) as { custom_id?: unknown; values?: unknown };
  if (data.custom_id !== "setup:roles" || !i.guild_id || !i.member?.user?.id) return reply("That action is not valid. Run `/content setup` again.");
  if (!hasManageServer(i.member.permissions)) return reply(NOT_ALLOWED);
  // Discord always sends an array (empty when every role was unticked); anything else is not a real click.
  if (!Array.isArray(data.values)) return reply("That action is not valid. Run `/content setup` again.");
  const values: unknown[] = data.values;
  if (!values.every((v): v is string => typeof v === "string" && SNOWFLAKE.test(v))) return reply("That role is not valid.");
  const ids = [...new Set(values)];
  if (ids.includes(i.guild_id)) return reply("@everyone cannot be an admin role. Pick specific roles.");
  if (ids.length > MAX_ADMIN_ROLES) return reply(`Pick at most ${MAX_ADMIN_ROLES} roles.`);
  await setAdminRoles(deps.sql, i.guild_id, ids);
  return { type: UPDATE_MESSAGE, data: setupPanel(await getAdminRoleIds(deps.sql, i.guild_id), await dashboardsOf(deps, i.guild_id), await listEventForums(deps.sql, i.guild_id)) };
}
