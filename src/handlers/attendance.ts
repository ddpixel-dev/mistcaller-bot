import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { leafOption } from "../discord/modal.ts";
import { getGuildSettings } from "../db/settings.ts";
import { getRosterView } from "../db/content.ts";
import { getManageTarget } from "../db/manage.ts";
import {
  claimReport, endContent, getAttendance, memberHistory, releaseReport, setAttended, submitAttendance, type Attendance,
} from "../db/attendance.ts";
import { canManage } from "../domain/permissions.ts";
import { renderAttendanceForm, renderReport } from "../render/attendance.ts";
import { renderRosterMessage } from "../render/roster.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_CONTENT = "There is no active content in this post.";
const NOT_ALLOWED = "Only the creator, a member with Manage Server, or the officer role can do that.";
const INVALID = "That form is out of date. Run `/content attendance` again.";

// Who may act: in the server, the creator, Manage Server or the officer role. In a direct message (the owner's
// form), only the creator, because roles cannot be seen there.
async function allowed(deps: Deps, i: Interaction, a: Attendance): Promise<string | null> {
  const actor = i.member?.user?.id ?? i.user?.id;
  if (!actor) return null;
  if (i.guild_id && i.guild_id !== a.guildId) return null;
  if (!i.member) return actor === a.createdBy ? actor : null;
  const settings = await getGuildSettings(deps.sql, a.guildId);
  const ok = canManage({ userId: actor, roles: i.member.roles ?? [], permissions: i.member.permissions }, { createdBy: a.createdBy }, settings?.officerRoleId ?? null);
  return ok ? actor : null;
}

async function names(deps: Deps, a: Attendance): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!deps.rest.memberName) return out;
  await Promise.all(a.players.map(async (p) => {
    const n = await deps.rest.memberName!(a.guildId, p.userId);
    if (n) out[p.userId] = n;
  }));
  return out;
}

const formData = async (deps: Deps, a: Attendance) => renderAttendanceForm(a, await names(deps, a));

// Post the report in the content's post, once, after the owner submitted. A failed post is released for the next run.
export async function postReport(deps: Deps, contentId: string): Promise<boolean> {
  const now = deps.now();
  if (!(await claimReport(deps.sql, contentId, now))) return false;
  try {
    const a = await getAttendance(deps.sql, contentId);
    if (!a) throw new Error("content vanished");
    await deps.rest.createMessage(a.threadId, renderReport(a));
    return true;
  } catch (err) {
    console.error(JSON.stringify({ evt: "report_failed", name: err instanceof Error ? err.name : "unknown" }));
    await releaseReport(deps.sql, contentId, now).catch(() => {});
    return false;
  }
}

// "/content attendance": a manager opens the form privately, once the content has started.
export async function handleAttendanceCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const target = i.guild_id && i.channel?.id ? await getManageTarget(deps.sql, i.guild_id, i.channel.id) : null;
  const a = target ? await getAttendance(deps.sql, target.id) : null;
  if (!a) return reply(NO_CONTENT);
  if (!(await allowed(deps, i, a))) return reply(NOT_ALLOWED);
  if (a.status === "cancelled") return reply("Cancelled content has no attendance.");
  if (a.startsAt > deps.now()) return reply("The content has not started yet. The form opens once it has.");
  if (a.reportPostedAt) return reply("The attendance was already submitted and the report posted.");
  return { type: CHANNEL_MESSAGE, data: { ...(await formData(deps, a)), flags: EPHEMERAL } };
}

// "/content end": a manager ends content that has started. It becomes done.
export async function handleEndCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const target = i.guild_id && i.channel?.id ? await getManageTarget(deps.sql, i.guild_id, i.channel.id) : null;
  const a = target ? await getAttendance(deps.sql, target.id) : null;
  if (!a || !target) return reply(NO_CONTENT);
  if (!(await allowed(deps, i, a))) return reply(NOT_ALLOWED);
  const result = await endContent(deps.sql, a.contentId, deps.now());
  if (result === "not_started") return reply("The content has not started yet. Cancel it instead if it will not happen.");
  if (result === "unavailable") return reply("This content is already finished or cancelled.");
  try {
    const view = await getRosterView(deps.sql, a.contentId, deps.now());
    if (view?.messageId) await deps.rest.editMessage(view.threadId, view.messageId, renderRosterMessage(view));
  } catch (err) {
    console.error(JSON.stringify({ evt: "roster_refresh_failed", name: err instanceof Error ? err.name : "unknown" }));
  }
  return reply(a.submittedAt ? "Content ended." : "Content ended. The attendance report is posted when the owner submits the attendance form.");
}

// "/content history @member": attended, no-show, and finished contents where the member was never marked.
export async function handleHistoryCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const member = leafOption(i, "member");
  if (!i.guild_id) return reply("Use this command inside the server.");
  if (typeof member !== "string" || !/^\d{5,25}$/.test(member)) return reply("Pick a member.");
  const h = await memberHistory(deps.sql, i.guild_id, member);
  return reply(`<@${member}>\n✅ Attended: ${h.attended}\n❌ No-show: ${h.noShow}\n❔ Not recorded: ${h.notRecorded}`);
}

// The buttons and the menu of the form: att:open (from the owner's DM), att:pick, att:submit, att:later.
export async function handleAttendanceComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = i.data as { custom_id?: unknown; values?: unknown } | undefined;
  const [prefix, action, id, extra] = typeof data?.custom_id === "string" ? data.custom_id.split(":") : [];
  if (prefix !== "att" || extra !== undefined || !id || !UUID.test(id)) return reply(INVALID);
  const a = await getAttendance(deps.sql, id);
  if (!a) return reply(INVALID);
  const actor = await allowed(deps, i, a);
  if (!actor) return reply(NOT_ALLOWED);
  if (a.reportPostedAt) return reply("The attendance was already submitted and the report posted.");

  if (action === "open") {
    const inDm = !i.guild_id;
    return { type: CHANNEL_MESSAGE, data: { ...(await formData(deps, a)), ...(inDm ? {} : { flags: EPHEMERAL }) } };
  }
  if (action === "pick") {
    const values = data?.values;
    if (!Array.isArray(values) || !values.every((v) => typeof v === "string" && /^\d{5,25}$/.test(v))) return reply(INVALID);
    const result = await setAttended(deps.sql, { contentId: id, userIds: values as string[], markedBy: actor, now: deps.now() });
    if (result !== "ok") return reply(INVALID);
    const fresh = await getAttendance(deps.sql, id);
    return { type: UPDATE_MESSAGE, data: await formData(deps, fresh!) };
  }
  if (action === "later") {
    return { type: UPDATE_MESSAGE, data: { content: "Saved. Open the form again from the button, or with `/content attendance`.", components: [], allowed_mentions: { parse: [] } } };
  }
  if (action === "submit") {
    const result = await submitAttendance(deps.sql, { contentId: id, markedBy: actor, now: deps.now() });
    if (result !== "ok") return reply(INVALID);
    const posted = await postReport(deps, id);
    return {
      type: UPDATE_MESSAGE,
      data: {
        content: posted ? "✅ Attendance submitted. The report is posted in the content's post." : "✅ Attendance submitted. The report could not be posted right now and will be retried.",
        components: [], allowed_mentions: { parse: [] },
      },
    };
  }
  return reply(INVALID);
}
