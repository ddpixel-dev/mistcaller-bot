import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { MAX_ADMIN_ROLES, getAdminRoleIds, setAdminRoles } from "../db/settings.ts";
import { hasManageServer, isAdmin } from "../domain/permissions.ts";
import { subOption } from "../discord/modal.ts";
import { deleteDashboard, getDashboard, setDashboardChannel, type Dashboard, type DashboardKind } from "../db/dashboard.ts";
import { refreshDashboard } from "../jobs/dashboards.ts";

const SNOWFLAKE = /^\d{5,25}$/;
const NOT_ALLOWED = "Only members with Manage Server can change the admin roles.";

const NOT_ADMIN = "Only an admin (an admin role, Manage Server or Administrator) can change the calendar channel.";
const BAD_CHANNEL = "Pick a text or announcement channel of this server.";
const KINDS: { kind: DashboardKind; label: string; set: string; clear: string; what: string }[] = [
  { kind: "schedule", label: "Calendar", set: "calendar-channel", clear: "clear-calendar", what: "the Events Calendar" },
];

// The panel: a role picker with the current admin roles already selected (ADR 0020, owner request 2026-10-08), and the
// channels now in use (FR-043, FR-044).
export function setupPanel(roleIds: string[], dashboards: Dashboard[] = []) {
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

export async function handleSetupCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  if (!i.guild_id || !i.member?.user?.id) return reply("Use this command inside the server.");
  const given = KINDS.map((k) => ({ k, channel: subOption(i, "setup", k.set), clear: subOption(i, "setup", k.clear) === true }));
  if (given.every((g) => g.channel === undefined && !g.clear)) {
    if (!hasManageServer(i.member.permissions)) return reply(NOT_ALLOWED);
    const roles = await getAdminRoleIds(deps.sql, i.guild_id);
    return { type: CHANNEL_MESSAGE, data: { ...setupPanel(roles, await dashboardsOf(deps, i.guild_id)), flags: EPHEMERAL } };
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
  const lines: string[] = [];
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
  return { type: UPDATE_MESSAGE, data: setupPanel(await getAdminRoleIds(deps.sql, i.guild_id), await dashboardsOf(deps, i.guild_id)) };
}
