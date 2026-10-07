import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { reply } from "../discord/response.ts";
import { subOption } from "../discord/modal.ts";
import { applySettings, type SettingsPatch } from "../db/settings.ts";
import { hasManageServer } from "../domain/permissions.ts";

const SNOWFLAKE = /^\d{5,25}$/;

function idOption(i: Interaction, name: string): string | undefined | null {
  const v = subOption(i, "setup", name);
  if (v === undefined) return undefined;
  return typeof v === "string" && SNOWFLAKE.test(v) ? v : null;
}

export async function handleSetupCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  if (!i.guild_id || !i.member?.user?.id) return reply("Use this command inside the server.");
  if (!hasManageServer(i.member.permissions)) return reply("Only members with Manage Server can run setup.");

  const officer = idOption(i, "officer-role");
  const pvp = idOption(i, "pvp-forum");
  const pve = idOption(i, "pve-forum");
  const cap = subOption(i, "setup", "daily-cap");
  if (officer === null || pvp === null || pve === null) return reply("That role or channel is not valid.");
  if (cap !== undefined && !(typeof cap === "number" && Number.isInteger(cap) && cap >= 1 && cap <= 50)) {
    return reply("The daily cap must be a whole number from 1 to 50.");
  }

  const patch: SettingsPatch = {
    ...(officer ? { officerRoleId: officer } : {}),
    ...(pvp ? { pvpForumId: pvp } : {}),
    ...(pve ? { pveForumId: pve } : {}),
    ...(typeof cap === "number" ? { dailyCap: cap } : {}),
  };
  const result = await applySettings(deps.sql, i.guild_id, patch);
  if (result.result === "needs_forums") {
    return reply("First setup needs both forums. Run `/content setup` with `pvp-forum` and `pve-forum`.");
  }
  if (result.result === "same_forum") return reply("The PvP and PvE forums must be different.");
  const s = result.settings;
  return reply(
    [
      "Setup saved.",
      `PvP forum: <#${s.pvpForumId}>`,
      `PvE forum: <#${s.pveForumId}>`,
      `Officer role: ${s.officerRoleId ? `<@&${s.officerRoleId}>` : "not set"}`,
      `Daily creation cap: ${s.dailyCap}`,
    ].join("\n"),
  );
}
