import { refreshDashboardSoon } from "../jobs/dashboards.ts";
import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, NOT_VALID, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { leafOption } from "../discord/modal.ts";
import { getAdminRoleIds } from "../db/settings.ts";
import { getRosterView } from "../db/content.ts";
import { targetOf } from "./manage.ts";
import {
  claimReport, endContent, getAttendance, memberHistory, releaseReport, reopenContent, setAttended, submitAttendance, type Attendance,
} from "../db/attendance.ts";
import { canManage, isAdmin } from "../domain/permissions.ts";
import { renderAttendanceForm, renderReport } from "../render/attendance.ts";
import { escapeText } from "../render/roster.ts";
import { refreshRosters } from "./rosters.ts";
import { groupName, groupsOf, partyChoice, partyOfClick } from "./party-pick.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_CONTENT = "There is no active content in this post.";
const NOT_ALLOWED = "Only the creator, a member with Manage Server, or an admin role can do that.";
const INVALID = "That form is out of date. Run `/content attendance` again.";

// Who may act: in the server, the creator, Manage Server or an admin role. In a direct message (the owner's
// form), only the creator, because roles cannot be seen there.
async function allowed(deps: Deps, i: Interaction, a: Attendance): Promise<string | null> {
  const actor = i.member?.user?.id ?? i.user?.id;
  if (!actor) return null;
  if (i.guild_id && i.guild_id !== a.guildId) return null;
  if (!i.member) return actor === a.createdBy ? actor : null;
  const adminRoles = await getAdminRoleIds(deps.sql, a.guildId);
  const ok = canManage({ userId: actor, roles: i.member.roles ?? [], permissions: i.member.permissions }, { createdBy: a.createdBy }, adminRoles);
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

// Two parties, or Bombers: the form starts with the party choice; a party (or Bombers) shows only its own players
// (FR-070, FR-071).
async function formData(deps: Deps, a: Attendance, party?: number) {
  const row = party ? null : partyChoice("att:g", a.contentId, a, { bombers: true });
  if (row) {
    return { content: `📋 **Attendance: ${escapeText(a.title)}**\nWhich party do you want to mark?`, components: [row], allowed_mentions: { parse: [] as [] } };
  }
  return renderAttendanceForm(a, await names(deps, a), party);
}

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
export async function handleAttendance(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const target = await targetOf(deps, i);
  const a = target ? await getAttendance(deps.sql, target.id) : null;
  if (!a) return reply(NO_CONTENT);
  if (!(await allowed(deps, i, a))) return reply(NOT_ALLOWED);
  if (a.status === "cancelled") return reply("Cancelled content has no attendance.");
  if (a.startsAt > deps.now()) return reply("The content has not started yet. The form opens once it has.");
  if (a.reportPostedAt) return reply("The attendance was already submitted and the report posted.");
  return { type: CHANNEL_MESSAGE, data: { ...(await formData(deps, a)), flags: EPHEMERAL } };
}

// "/content end": a manager ends content that has started. It becomes done.
export async function handleEnd(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const target = await targetOf(deps, i);
  const a = target ? await getAttendance(deps.sql, target.id) : null;
  if (!a || !target) return reply(NO_CONTENT);
  if (!(await allowed(deps, i, a))) return reply(NOT_ALLOWED);
  const result = await endContent(deps.sql, a.contentId, deps.now());
  if (result === "not_started") return reply("The content has not started yet. Cancel it instead if it will not happen.");
  if (result === "unavailable") return reply("This content is already finished or cancelled.");
  try {
    const view = await getRosterView(deps.sql, a.contentId, deps.now());
    if (view?.messageId) await refreshRosters(deps, view);
  } catch (err) {
    console.error(JSON.stringify({ evt: "roster_refresh_failed", name: err instanceof Error ? err.name : "unknown" }));
  }
  await refreshDashboardSoon(deps, a.guildId, "schedule");
  return reply(a.submittedAt ? "Content ended." : "Content ended. The attendance report is posted when the owner submits the attendance form.");
}

// "/content reopen": a manager reopens ended content (owner decision 2026-10-09). It is live again, with a fresh
// 4-hour auto-end window. The attendance report is not touched.
export async function handleReopen(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const target = await targetOf(deps, i);
  const a = target ? await getAttendance(deps.sql, target.id) : null;
  if (!a || !target) return reply(NO_CONTENT);
  if (!(await allowed(deps, i, a))) return reply(NOT_ALLOWED);
  const result = await reopenContent(deps.sql, a.contentId, deps.now());
  if (result === "not_ended") return reply("This content is not ended, so there is nothing to reopen.");
  try {
    const view = await getRosterView(deps.sql, a.contentId, deps.now());
    if (view?.messageId) await refreshRosters(deps, view);
  } catch (err) {
    console.error(JSON.stringify({ evt: "roster_refresh_failed", name: err instanceof Error ? err.name : "unknown" }));
  }
  await refreshDashboardSoon(deps, a.guildId, "schedule");
  return reply("Content reopened: signups, edits and every other action work again. It ends by itself 4 hours from now unless you end it with `/content end`.");
}

// "/content history @member": attended, no-show, and finished contents where the member was never marked. Everyone sees
// their own; another member's history is for admins only (FR-045, owner decision 2026-10-15).
export async function handleHistoryCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const member = leafOption(i, "member");
  if (!i.guild_id) return reply("Use this command inside the server.");
  if (typeof member !== "string" || !/^\d{5,25}$/.test(member)) return reply("Pick a member.");
  const actor = i.member?.user?.id;
  if (!actor) return reply("Use this command inside the server.");
  if (member !== actor) {
    const adminRoles = await getAdminRoleIds(deps.sql, i.guild_id);
    if (!isAdmin({ userId: actor, roles: i.member?.roles ?? [], permissions: i.member?.permissions }, adminRoles)) {
      return reply("You can see your own attendance history. Only a server admin (an admin role or Manage Server) can see another member's.");
    }
  }
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

  if (partyOfClick(i, a, { bombers: true }) === null) return reply(NOT_VALID);
  const groups = groupsOf(a, { bombers: true });
  const party = groups.length >= 2 ? i.party ?? 1 : undefined;
  if (action === "g") {
    return { type: UPDATE_MESSAGE, data: await formData(deps, a, party ?? 1) };
  }
  if (action === "open") {
    const inDm = !i.guild_id;
    return { type: CHANNEL_MESSAGE, data: { ...(await formData(deps, a)), ...(inDm ? {} : { flags: EPHEMERAL }) } };
  }
  if (action === "pick") {
    const values = data?.values;
    if (!Array.isArray(values) || !values.every((v) => typeof v === "string" && /^\d{5,25}$/.test(v))) return reply(INVALID);
    const result = await setAttended(deps.sql, { contentId: id, userIds: values as string[], markedBy: actor, now: deps.now(), party });
    if (result !== "ok") return reply(INVALID);
    const fresh = await getAttendance(deps.sql, id);
    return { type: UPDATE_MESSAGE, data: await formData(deps, fresh!, party) };
  }
  if (action === "later") {
    return { type: UPDATE_MESSAGE, data: { content: "Saved. Open the form again from the button, or with `/content attendance`.", components: [], allowed_mentions: { parse: [] } } };
  }
  if (action === "submit") {
    const result = await submitAttendance(deps.sql, { contentId: id, markedBy: actor, now: deps.now(), party });
    if (result !== "ok") return reply(INVALID);
    const after = await getAttendance(deps.sql, id);
    if (after && !after.submittedAt) {
      // Bombers with nobody in them count as submitted, so they are not named.
      const todo = groupsOf(after, { bombers: true }).filter((n) => !after.partiesSubmitted.includes(n) && (n <= after.partyCount || after.players.some((p) => p.party === n)));
      const every = after.bombers !== null ? "every party and Bombers are" : "every party is";
      return { type: UPDATE_MESSAGE, data: { content: `✅ ${groupName(party ?? 1)} submitted. Still to do: ${todo.map(groupName).join(", ")}. The report posts once ${every} submitted.`, components: [], allowed_mentions: { parse: [] as [] } } };
    }
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
