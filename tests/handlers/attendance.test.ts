import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setMessageId } from "../../src/db/content.ts";
import { claimSlot } from "../../src/db/signup.ts";
import { getAttendance, memberHistory } from "../../src/db/attendance.ts";
import { postPendingReports, sendAttendanceDms } from "../../src/jobs/cron.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { discordProblems, flatComponents, textOf } from "../helpers/discordLimits.ts";

const START = new Date("2026-12-01T18:00:00Z");
const AFTER = new Date(START.getTime() + 10 * 60000);
const BEFORE = new Date(START.getTime() - 60 * 60000);
const P1 = "100000000000000001", P2 = "100000000000000002", P3 = "100000000000000003";
const NAMES: Record<string, string> = { [P1]: "Ahmed", [P2]: "Sara", [P3]: "Omar" };
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup(opts: { dmFails?: boolean; postFails?: () => boolean } = {}) {
  const sql = await testSql();
  await sql`insert into guild_admin_role (guild_id, role_id) values ('g1', 'officer')`;
  const id = await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvp", title: "Raid *night*", notes: null, startsAt: START,
    tier: "T8.0", hasLoot: false, createdBy: "boss", now: BEFORE,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }, { role: "DPS", weapon: "Bow" }, { role: "DPS", weapon: "Axe" }],
  });
  await setMessageId(sql, id, "m1");
  const slots = (await getRosterView(sql, id, BEFORE))!.slots.map((s) => s.id);
  for (const [i, u] of [P1, P2, P3].entries()) await claimSlot(sql, { contentId: id, slotId: slots[i]!, userId: u, guildId: "g1", now: BEFORE });
  const posts: { channel: string; body: any }[] = [];
  const edits: any[] = [];
  const rest: Rest = {
    async createMessage(channel, body) {
      if (opts.postFails?.()) throw new Error("boom");
      posts.push({ channel, body });
      return { id: "x" };
    },
    async editMessage(channel, message, body) { edits.push({ channel, message, body }); },
    async deleteMessage() {},
    async createDm(user) { if (opts.dmFails) throw new Error("DMs closed"); return `dm-${user}`; },
    async memberName(_g, user) { return NAMES[user] ?? null; },
  };
  let now = AFTER;
  const deps: Deps = { sql, rest, now: () => now };
  return { sql, id, slots, deps, d: createDispatch(deps), posts, edits, setNow: (t: Date) => { now = t; } };
}

const member = (user: string, roles: string[] = [], permissions?: string) => ({ user: { id: user }, roles, permissions });
const cmd = (sub: string, user = "boss", extra: Partial<Interaction> = {}, options: unknown[] = []): Interaction => ({
  id: "i", type: 2, application_id: "a", token: "t", guild_id: "g1", channel_id: "t1",
  channel: { id: "t1", type: 11, parent_id: "fp" }, member: member(user),
  data: { name: "content", options: [{ name: sub, type: 1, options }] }, ...extra,
});
const click = (customId: string, user = "boss", values?: unknown[], extra: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1", member: member(user),
  data: { custom_id: customId, component_type: values ? 3 : 2, ...(values ? { values } : {}) }, ...extra,
});
const dmClick = (customId: string, user: string, values?: unknown[]): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", user: { id: user },
  data: { custom_id: customId, component_type: values ? 3 : 2, ...(values ? { values } : {}) },
});
const text = (r: any) => r.data.content as string;
const marks = async (sql: any, id: string) => Object.fromEntries((await sql`select user_id, status from attendance where content_id = ${id}`).map((r: any) => [r.user_id, r.status]));
const isEphemeral = (r: any, t?: string) => { assert.equal(r.type, 4); assert.equal(r.data.flags, 64); if (t) assert.ok(text(r).includes(t), text(r)); };

test("/content end: only a manager, only after the start; the content becomes done and the roster is refreshed", async () => {
  const { sql, id, d, setNow, edits, posts } = await setup();
  setNow(BEFORE);
  isEphemeral(await d(cmd("end")), "not started");
  setNow(AFTER);
  isEphemeral(await d(cmd("end", "stranger")), "Only the creator");
  assert.equal((await sql`select status from content`)[0]!.status, "open");
  const r = await d(cmd("end"));
  assert.ok(text(r).includes("Content ended."));
  assert.ok(text(r).includes("posted when the owner submits"));
  const [row] = await sql`select status, ended_at from content where id = ${id}`;
  assert.equal(row!.status, "done");
  assert.ok(row!.ended_at);
  assert.equal(edits.length, 1);
  assert.ok(textOf(edits[0].body).includes("Concluded."));
  assert.equal(posts.length, 0);
  isEphemeral(await d(cmd("end")), "already finished");
});

test("/content reopen: a manager reopens ended content; it is live again, with a fresh auto-end window", async () => {
  const { sql, id, slots, d, edits, deps } = await setup();
  isEphemeral(await d(cmd("reopen")), "not ended");
  await d(cmd("end"));
  edits.length = 0;
  isEphemeral(await d(cmd("reopen", "stranger")), "Only the creator");
  assert.equal((await sql`select status from content`)[0]!.status, "done");
  const r = await d(cmd("reopen"));
  assert.ok(text(r).includes("Content reopened"), text(r));
  const [row] = await sql`select status, ended_at, reopened_at from content where id = ${id}`;
  assert.equal(row!.status, "open");
  assert.equal(row!.ended_at, null);
  assert.equal(new Date(row!.reopened_at).getTime(), AFTER.getTime());
  assert.equal(edits.length, 1);
  assert.ok(!textOf(edits[0].body).includes("Concluded."));
  assert.ok(flatComponents(edits[0].body).some((c) => c.custom_id === `join:${id}`));
  assert.equal(await claimSlot(deps.sql, { contentId: id, slotId: slots[3]!, userId: "late", guildId: "g1", now: AFTER }), "claimed");
  isEphemeral(await d(cmd("reopen")), "not ended");
});

test("/content reopen also reopens content that ended by itself, an officer may do it, and cancelled content cannot be reopened", async () => {
  const { sql, d } = await setup();
  await sql`update content set status = 'done', ended_at = ${AFTER}`;
  assert.ok(text(await d(cmd("reopen", "o", { member: member("o", ["officer"]) }))).includes("Content reopened"));
  await sql`update content set status = 'cancelled'`;
  isEphemeral(await d(cmd("reopen")), "no active content");
  isEphemeral(await d(cmd("reopen", "boss", { channel: { id: "other", type: 11, parent_id: "fp" } })), "no active content");
});

test("reopening does not undo or resend the attendance report", async () => {
  const { sql, d, posts } = await setup();
  await d(cmd("end"));
  await sql`update content set attendance_submitted_at = ${AFTER}, report_posted_at = ${AFTER}`;
  assert.ok(text(await d(cmd("reopen"))).includes("Content reopened"));
  const [row] = await sql`select report_posted_at from content`;
  assert.ok(row!.report_posted_at);
  assert.equal(posts.length, 0);
});

test("an officer and Manage Server may end; the report is NOT posted just because the content ended", async () => {
  const { d, posts } = await setup();
  assert.ok(text(await d(cmd("end", "x", {}, []))).includes("Only the creator"));
  const r = await d(cmd("end", "o", { member: member("o", ["officer"]) }));
  assert.ok(text(r).includes("Content ended."));
  assert.equal(posts.length, 0);
});

test("/content attendance opens the form privately with the signed-up players' names, only for a manager after the start", async () => {
  const { id, d, setNow } = await setup();
  setNow(BEFORE);
  isEphemeral(await d(cmd("attendance")), "not started");
  setNow(AFTER);
  isEphemeral(await d(cmd("attendance", "stranger")), "Only the creator");
  const r: any = await d(cmd("attendance"));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.ok(text(r).includes("Raid \\*night\\*"));
  const menu = flatComponents(r.data).find((c) => c.type === 3)!;
  assert.equal(menu.custom_id, `att:pick:${id}`);
  assert.deepEqual([menu.min_values, menu.max_values], [0, 3]);
  assert.deepEqual(menu.options.map((o: any) => o.label), ["1. Ahmed", "2. Sara", "3. Omar"]);
  assert.deepEqual(menu.options.map((o: any) => o.value), [P1, P2, P3]);
  assert.ok(menu.options.every((o: any) => !o.default));
  assert.deepEqual(flatComponents(r.data).filter((c) => c.type === 2).map((c) => c.label), ["Submit", "Save and finish later"]);
  assert.deepEqual(discordProblems(r.data), []);
});

test("a name that cannot be fetched falls back to the position", async () => {
  const { d, deps } = await setup();
  deps.rest.memberName = async () => null;
  const r: any = await d(cmd("attendance"));
  assert.deepEqual(flatComponents(r.data).find((c) => c.type === 3)!.options.map((o: any) => o.label), ["1. Player 1", "2. Player 2", "3. Player 3"]);
});

test("picking marks exactly those as attended; deselecting returns them to not recorded, never to no-show", async () => {
  const { sql, id, d } = await setup();
  const pick = async (values: string[], user = "boss") => d(click(`att:pick:${id}`, user, values));
  const r: any = await pick([P1, P3]);
  assert.equal(r.type, 7);
  assert.deepEqual(await marks(sql, id), { [P1]: "attended", [P3]: "attended" });
  assert.deepEqual(flatComponents(r.data).find((c) => c.type === 3)!.options.map((o: any) => !!o.default), [true, false, true]);
  await pick([P3]);
  assert.deepEqual(await marks(sql, id), { [P3]: "attended" });
  await pick([]);
  assert.deepEqual(await marks(sql, id), {});
  isEphemeral(await pick(["stranger"]), "out of date");
  isEphemeral(await pick([P1], "nobody"), "Only the creator");
  assert.deepEqual(await marks(sql, id), {});
});

test("Submit records the rest as no-shows and posts the report once in the content's post, pinging nobody", async () => {
  const { sql, id, d, posts } = await setup();
  await d(click(`att:pick:${id}`, "boss", [P1, P2]));
  const r: any = await d(click(`att:submit:${id}`));
  assert.equal(r.type, 7);
  assert.ok(text(r).includes("Attendance submitted"));
  assert.deepEqual(r.data.components, []);
  assert.deepEqual(await marks(sql, id), { [P1]: "attended", [P2]: "attended", [P3]: "no_show" });
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.channel, "t1");
  const body = posts[0]!.body;
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.equal(body.content, `📋 **Attendance: Raid \\*night\\***\n✅ **Attended (2):** <@${P1}> <@${P2}>\n❌ **No-show (1):** <@${P3}>`);
  assert.deepEqual(discordProblems(body), []);
  isEphemeral(await d(click(`att:submit:${id}`)), "already submitted");
  isEphemeral(await d(click(`att:pick:${id}`, "boss", [P1])), "already submitted");
  assert.equal(posts.length, 1);
});

test("the report is posted when the owner submits, before or after the content is ended", async () => {
  const a = await setup();
  await a.d(click(`att:submit:${a.id}`));
  assert.equal(a.posts.length, 1);
  assert.equal((await a.sql`select status from content`)[0]!.status, "open");
});

test("Save and finish later keeps the picks, closes the message, and posts nothing", async () => {
  const { sql, id, d, posts } = await setup();
  await d(click(`att:pick:${id}`, "boss", [P2]));
  const r: any = await d(click(`att:later:${id}`));
  assert.equal(r.type, 7);
  assert.deepEqual(r.data.components, []);
  assert.deepEqual(await marks(sql, id), { [P2]: "attended" });
  assert.equal(posts.length, 0);
  assert.equal((await sql`select attendance_submitted_at from content`)[0]!.attendance_submitted_at, null);
});

test("a failed report post is released and retried by the scheduled job, then posted once", async () => {
  let fail = true;
  const { sql, id, d, deps, posts } = await setup({ postFails: () => fail });
  const r: any = await d(click(`att:submit:${id}`));
  assert.ok(text(r).includes("will be retried"));
  assert.equal(posts.length, 0);
  assert.equal((await sql`select report_posted_at from content`)[0]!.report_posted_at, null);
  fail = false;
  assert.equal(await postPendingReports(deps), 1);
  assert.equal(await postPendingReports(deps), 0);
  assert.equal(posts.length, 1);
  assert.ok(posts[0]!.body.content.includes("No-show (3)"));
});

test("the owner's direct-message form works without a server, only for the creator", async () => {
  const { sql, id, d, posts } = await setup();
  const open: any = await d(dmClick(`att:open:${id}`, "boss"));
  assert.equal(open.type, 4);
  assert.equal(open.data.flags, undefined);
  assert.deepEqual(discordProblems(open.data), []);
  isEphemeral(await d(dmClick(`att:open:${id}`, P1)), "Only the creator");
  const picked: any = await d(dmClick(`att:pick:${id}`, "boss", [P1]));
  assert.equal(picked.type, 7);
  const done: any = await d(dmClick(`att:submit:${id}`, "boss"));
  assert.ok(text(done).includes("submitted"));
  assert.deepEqual(await marks(sql, id), { [P1]: "attended", [P2]: "no_show", [P3]: "no_show" });
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.channel, "t1");
});

test("the form refuses tampered ids, another guild and unknown content", async () => {
  const { id, d } = await setup();
  for (const bad of ["att:", "att:pick", "att:pick:nope", `att:zzz:${id}`, `att:pick:${id}:x`, "att:open:00000000-0000-4000-8000-000000000000"]) {
    const r: any = await d(click(bad, "boss", bad.includes("pick") ? [P1] : undefined));
    assert.equal(r.data.flags, 64, bad);
  }
  isEphemeral(await d(click(`att:open:${id}`, "boss", undefined, { guild_id: "g2" })), "Only the creator");
  isEphemeral(await d(click(`att:pick:${id}`, "boss", [5 as any])), "out of date");
});

test("/content history counts attended, no-shows and finished contents where the member was never marked", async () => {
  const { sql, id, d, deps } = await setup();
  await d(click(`att:pick:${id}`, "boss", [P1]));
  await d(click(`att:submit:${id}`));
  const other = await createContent(sql, {
    guildId: "g1", threadId: "t2", type: "pvp", title: "Second", notes: null, startsAt: START,
    tier: "T8.0", hasLoot: false, createdBy: "boss", now: BEFORE,
    slots: [{ role: "Tank", weapon: "Mace" }],
  });
  const slot = (await getRosterView(sql, other, BEFORE))!.slots[0]!.id;
  await claimSlot(sql, { contentId: other, slotId: slot, userId: P2, guildId: "g1", now: BEFORE });
  await sql`update content set status = 'done' where id = ${other}`;
  assert.deepEqual(await memberHistory(sql, "g1", P1), { attended: 1, noShow: 0, notRecorded: 0 });
  assert.deepEqual(await memberHistory(sql, "g1", P2), { attended: 0, noShow: 1, notRecorded: 0 + 1 });
  assert.deepEqual(await memberHistory(sql, "g2", P2), { attended: 0, noShow: 0, notRecorded: 0 });
  const r = await d({ ...cmd("history", "boss", {}, [{ name: "member", type: 6, value: "123456789012345678" }]) });
  assert.ok(text(r).includes("<@123456789012345678>") && text(r).includes("Attended: 0"));
  const invalid: any = await d({ ...cmd("history", "x", {}, [{ name: "member", type: 6, value: "not-a-user" }]) });
  assert.ok(text(invalid).includes("Pick a member"));
  void deps;
});

test("the scheduled job DMs the owner 5 minutes after the start, once, with a button that opens the form", async () => {
  const { id, deps, posts, setNow } = await setup();
  const dms: any[] = [];
  deps.rest.createMessage = async (channel, body) => { dms.push({ channel, body }); return { id: "x" }; };
  setNow(new Date(START.getTime() + 4 * 60000));
  assert.equal(await sendAttendanceDms(deps), 0);
  setNow(new Date(START.getTime() + 5 * 60000));
  assert.equal(await sendAttendanceDms(deps), 1);
  assert.equal(await sendAttendanceDms(deps), 0);
  assert.equal(dms.length, 1);
  assert.equal(dms[0].channel, "dm-boss");
  assert.ok(dms[0].body.content.includes("Raid \\*night\\*"));
  assert.equal(flatComponents(dms[0].body).find((c) => c.type === 2)!.custom_id, `att:open:${id}`);
  assert.deepEqual(discordProblems(dms[0].body), []);
  void posts;
});

test("when the DM cannot be sent, a note with the command goes in the content's post instead", async () => {
  const { deps, posts, setNow } = await setup({ dmFails: true });
  setNow(AFTER);
  assert.equal(await sendAttendanceDms(deps), 1);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.channel, "t1");
  assert.ok(posts[0]!.body.content.includes("<@boss>") && posts[0]!.body.content.includes("/content attendance"));
  assert.deepEqual(posts[0]!.body.allowed_mentions, { users: ["boss"] });
});

test("no DM when nobody signed up, after the form was submitted, or for cancelled content; failures are retried", async () => {
  const empty = await setup();
  await empty.sql`delete from signup`;
  assert.equal(await sendAttendanceDms(empty.deps), 0);
  await resetDb(empty.sql);
  const a = await setup();
  await a.d(click(`att:submit:${a.id}`));
  a.posts.length = 0;
  assert.equal(await sendAttendanceDms(a.deps), 0);
  await resetDb(a.sql);
  const c = await setup();
  await c.sql`update content set status = 'cancelled'`;
  assert.equal(await sendAttendanceDms(c.deps), 0);
  await resetDb(c.sql);
  let fail = true;
  const r = await setup({ dmFails: true, postFails: () => fail });
  assert.equal(await sendAttendanceDms(r.deps), 0);
  assert.equal((await r.sql`select attendance_dm_sent_at from content`)[0]!.attendance_dm_sent_at, null);
  fail = false;
  assert.equal(await sendAttendanceDms(r.deps), 1);
});

test("a 20-player form and report stay inside Discord's limits", async () => {
  const { sql, deps, d, id, slots } = await setup();
  for (let n = 3; n < 20; n++) {
    const slot = await sql`insert into slot (guild_id, content_id, position, role, weapon) values ('g1', ${id}, ${n + 2}, 'DPS', 'Bow') returning id`;
    await claimSlot(sql, { contentId: id, slotId: slot[0]!.id, userId: (100000000000000100n + BigInt(n)).toString(), guildId: "g1", now: BEFORE });
  }
  void slots;
  const form: any = await d(cmd("attendance"));
  assert.equal(flatComponents(form.data).find((c) => c.type === 3)!.options.length, 20);
  assert.deepEqual(discordProblems(form.data), []);
  const a = (await getAttendance(sql, id))!;
  const { renderReport } = await import("../../src/render/attendance.ts");
  assert.ok(renderReport(a).content.length <= 2000);
  void deps;
});
