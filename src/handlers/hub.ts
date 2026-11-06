import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { reply } from "../discord/response.ts";
import { getAdminRoleIds } from "../db/settings.ts";
import { getCtaChannel, getCtaRoleIds } from "../db/cta.ts";
import { listEventForums } from "../db/eventForum.ts";
import { canCreateCta } from "../domain/permissions.ts";
import { openCard } from "./card.ts";
import { NOT_HERE } from "./create.ts";

export const NOT_CTA = "Special content (CTA) is for admins and members with a CTA role. Ask an admin to add your role in `/content setup`.";
export const NO_CTA_CHANNEL = "No CTA channel is set yet. An admin must run `/content setup` with `cta-channel` first.";
export const NO_EVENT_FORUM = "No event forum is set yet. An admin must run `/content setup` with `event-forum` and `forum-type` first.";

// hub:n and hub:c: the Normal content and Special content (CTA) buttons of the content-management channel (FR-059,
// ADR 0036). Both open the creation card, privately, in this channel. CTA is checked here and again at Create.
export async function handleHub(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const which = typeof raw === "string" ? raw.split(":")[1] : undefined;
  const userId = i.member?.user?.id;
  if (!i.guild_id || !userId || !i.channel?.id || (which !== "n" && which !== "c")) return reply(NOT_HERE);
  if (which === "c") {
    const actor = { userId, roles: i.member?.roles ?? [], permissions: i.member?.permissions };
    if (!canCreateCta(actor, await getAdminRoleIds(deps.sql, i.guild_id), await getCtaRoleIds(deps.sql, i.guild_id))) return reply(NOT_CTA);
    if (!(await getCtaChannel(deps.sql, i.guild_id))) return reply(NO_CTA_CHANNEL);
  } else if ((await listEventForums(deps.sql, i.guild_id)).length === 0) {
    return reply(NO_EVENT_FORUM);
  }
  return await openCard(deps, i, { targetForumId: null, forumType: null, title: null, cta: which === "c" });
}
