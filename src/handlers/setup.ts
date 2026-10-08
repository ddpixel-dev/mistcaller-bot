import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { MAX_ADMIN_ROLES, getAdminRoleIds, setAdminRoles } from "../db/settings.ts";
import { hasManageServer } from "../domain/permissions.ts";

const SNOWFLAKE = /^\d{5,25}$/;
const NOT_ALLOWED = "Only members with Manage Server can change the admin roles.";

// The panel: a role picker with the current admin roles already selected (ADR 0020, owner request 2026-10-08).
export function setupPanel(roleIds: string[]) {
  const current = roleIds.length ? roleIds.map((r) => `<@&${r}>`).join(" ") : "none yet";
  return {
    content: [
      "**Admin roles**",
      "Members with these roles can manage any content and the presets, like the content's owner. Members with Manage Server or Administrator always can.",
      `Now: ${current}`,
      `Pick up to ${MAX_ADMIN_ROLES} roles below; the list saves as soon as you change it.`,
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

export async function handleSetupCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  if (!i.guild_id || !i.member?.user?.id) return reply("Use this command inside the server.");
  if (!hasManageServer(i.member.permissions)) return reply(NOT_ALLOWED);
  const roles = await getAdminRoleIds(deps.sql, i.guild_id);
  return { type: CHANNEL_MESSAGE, data: { ...setupPanel(roles), flags: EPHEMERAL } };
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
  return { type: UPDATE_MESSAGE, data: setupPanel(await getAdminRoleIds(deps.sql, i.guild_id)) };
}
