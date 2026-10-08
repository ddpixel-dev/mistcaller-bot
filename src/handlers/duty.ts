import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { reply } from "../discord/response.ts";
import { leafOption } from "../discord/modal.ts";
import { getAdminRoleIds } from "../db/settings.ts";
import { getRosterView } from "../db/content.ts";
import { getManageTarget, setSlotDuty } from "../db/manage.ts";
import { canManage } from "../domain/permissions.ts";
import { CLEAR_DUTY, DUTY_WORD, dutyDef } from "../domain/duties.ts";
import { renderRosterMessage } from "../render/roster.ts";

// "/content duty position:<n> duty:<Caller|Scout|Rat|Clear>": assigned by the content's managers.
export async function handleDutyCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const userId = i.member?.user?.id;
  if (!i.guild_id || !userId || !i.channel?.id) return reply("Use this command inside a content post.");
  const target = await getManageTarget(deps.sql, i.guild_id, i.channel.id);
  if (!target) return reply("There is no active content in this post.");
  const adminRoles = await getAdminRoleIds(deps.sql, i.guild_id);
  const allowed = canManage(
    { userId, roles: i.member?.roles ?? [], permissions: i.member?.permissions },
    { createdBy: target.createdBy },
    adminRoles,
  );
  if (!allowed) return reply("Only the creator, a member with Manage Server, or an admin role can do that.");

  const position = leafOption(i, "position");
  const duty = leafOption(i, "duty");
  if (typeof position !== "number" || !Number.isInteger(position) || position < 1 || position > 20) {
    return reply("Give the position number, from 1 to 20.");
  }
  if (typeof duty !== "string" || (duty !== CLEAR_DUTY && !dutyDef(duty))) return reply(`Pick a ${DUTY_WORD.toLowerCase()} from the list.`);

  const result = await setSlotDuty(deps.sql, { contentId: target.id, position, duty: duty === CLEAR_DUTY ? null : duty });
  if (result === "unavailable") return reply("This content is no longer open, so duties cannot change.");
  if (result === "no_slot") return reply(`There is no position ${position}.`);

  let refreshed = false;
  try {
    const view = await getRosterView(deps.sql, target.id, deps.now());
    if (view?.messageId) {
      await deps.rest.editMessage(view.threadId, view.messageId, renderRosterMessage(view));
      refreshed = true;
    }
  } catch (err) {
    console.error(JSON.stringify({ evt: "roster_refresh_failed", name: err instanceof Error ? err.name : "unknown" }));
  }
  const label = duty === CLEAR_DUTY ? `${DUTY_WORD} cleared` : `${dutyDef(duty)!.label} assigned`;
  return reply(`${label} for position ${position}.${refreshed ? "" : " The roster message will update on the next change."}`);
}
