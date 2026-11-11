import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView } from "../../src/db/content.ts";
import { claimSlot, joinBombers, joinWaitlist, setTentative } from "../../src/db/signup.ts";
import { pingTargets } from "../../src/db/ping.ts";
import { castVote } from "../../src/db/vote.ts";
import { getStats } from "../../src/db/stats.ts";
import { getAttendance, memberHistory } from "../../src/db/attendance.ts";
import { sendAttendanceDms, sendReminders } from "../../src/jobs/cron.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import { withHostActions } from "../helpers/host.ts";
import { IS_COMPONENTS_V2, renderMovedNote, renderRosterMessage } from "../../src/render/roster.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { flatComponents } from "../helpers/discordLimits.ts";

// FR-071: the Bombers button, and Bombers in the host panels, Ping, Leave, Tentative, attendance and statistics.
const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 40 * 60000);
const AFTER = new Date(START.getTime() + 10 * 60000);
const G = "g1";
const OWNER = "100000000000000009";
const [A, B, C, D] = ["100000000000000001", "100000000000000002", "100000000000000003", "100000000000000004"];
const edits: { channel: string; messageId: string; body: any }[] = [];
const posts: { channel: string; body: any }[] = [];
const rest: Rest = {
  async createMessage(channel, body) { posts.push({ channel, body }); return { id: "x" }; },
  async editMessage(channel: string, messageId: string, body: unknown) { edits.push({ channel, messageId, body }); },
  async deleteMessage() {},
  async createDm(user) { return `dm-${user}`; },
  async memberName(_g, u) { return `Name-${u.slice(-1)}`; },
};
beforeEach(async () => { edits.length = 0; posts.length = 0; await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

type Opts = { parties?: 1 | 2; bombers?: number | null; selection?: boolean; now?: Date };
async function setup(o: Opts = {}) {
  const sql = await testSql();
  await sql`insert into guild_admin_role (guild_id, role_id) values (${G}, 'officer') on conflict do nothing`;
  const parties = o.parties ?? 2;
  const id = await createContent(sql, {
    guildId: G, threadId: "t1", type: "pvp", title: "CTA", notes: null, startsAt: START, tier: "T8", hasLoot: true,
    createdBy: OWNER, now: NOW, cta: true, rosterChannelId: "rc1", bombers: o.bombers === undefined ? 2 : o.bombers, selection: o.selection ?? false,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "DPS", weapon: "Bow" }],
    ...(parties === 2 ? { slots2: [{ role: "Healer", weapon: "Holy" }, { role: "DPS", weapon: "Bow" }] } : {}),
  });
  await sql`update content set message_id = 'm1' where id = ${id}`;
  let now = o.now ?? NOW;
  const deps: Deps = { sql, rest, now: () => now };
  const v = (await getRosterView(sql, id, NOW))!;
  return {
    sql, id, deps, d: withHostActions(createDispatch(deps), deps), view: async () => (await getRosterView(sql, id, now))!,
    p1: v.slots.filter((s) => s.party === 1).map((s) => s.id), p2: v.slots.filter((s) => s.party === 2).map((s) => s.id),
    bomb: (u: string) => joinBombers(sql, { contentId: id, guildId: G, userId: u, now: NOW }),
    setNow: (t: Date) => { now = t; },
  };
}
const base = (user: string, messageId = "m1", roles: string[] = []): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: G, channel: { id: "rc1", type: 0 },
  message: { id: messageId, flags: IS_COMPONENTS_V2 }, member: { user: { id: user }, roles },
});
const button = (customId: string, user = OWNER, messageId = "m1"): Interaction => ({ ...base(user, messageId), data: { custom_id: customId, component_type: 2 } });
const menu = (customId: string, values: unknown[], user = OWNER, messageId = "m1"): Interaction => ({ ...base(user, messageId), data: { custom_id: customId, component_type: 3, values } });
const text = (r: any) => JSON.stringify(r.data);
const isPrivate = (r: any, has: string) => {
  assert.equal(r.type, 4, text(r));
  assert.equal(r.data.flags & 64, 64, "ephemeral");
  assert.ok(String(r.data.content).includes(has), String(r.data.content));
};
const choice = (r: any) => r.data.components[0].components.map((c: any) => [c.label, c.emoji?.name ?? null, c.custom_id]);
const entry = async (sql: any, id: string, u: string) => (await sql`select status, slot_id, party from signup where content_id = ${id} and user_id = ${u}`)[0];

// ---- the Bombers button ----

test("Bombers: joining answers with the whole CTA; no other message is edited", async () => {
  const { sql, id, d, view } = await setup();
  const r: any = await d(button(`bomb:${id}`, A));
  assert.equal(r.type, 7);
  assert.equal((await entry(sql, id, A)).status, "bomber");
  assert.deepEqual(r.data, renderRosterMessage(await view()));
  assert.ok(text(r).includes("Bombers 1/2"));
  assert.equal(edits.length, 0);
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
});

test("Bombers: already, full, off and not open answer privately", async () => {
  const s = await setup({ bombers: 1 });
  await s.d(button(`bomb:${s.id}`, A));
  isPrivate(await s.d(button(`bomb:${s.id}`, A)), "You are in Bombers. Press Leave to leave.");
  isPrivate(await s.d(button(`bomb:${s.id}`, B)), "Bombers is full.");
  await s.sql`update content set status = 'locked' where id = ${s.id}`;
  isPrivate(await s.d(button(`bomb:${s.id}`, C)), "Signups are locked for this content.");
  await s.sql`update content set status = 'open', bombers = null where id = ${s.id}`;
  isPrivate(await s.d(button(`bomb:${s.id}`, C)), "This control is not valid");
  assert.equal(await entry(s.sql, s.id, C), undefined);
});

test("Bombers: another guild's content and a bad id are refused; the verified guild is used", async () => {
  const { sql, id, d } = await setup();
  isPrivate(await d({ ...button(`bomb:${id}`, A), guild_id: "g2" }), "no longer exists");
  isPrivate(await d(button(`bomb:nope`, A)), "not valid");
  isPrivate(await d(button(`bomb:${id}:x`, A)), "not valid");
  assert.equal(await entry(sql, id, A), undefined);
});

test("Bombers: in a host-selected event a seated player is told only the host moves them", async () => {
  const { sql, id, d, p1 } = await setup({ selection: true });
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status, party) values (${G}, ${id}, ${A}, ${p1[0]}, 'signed', 1)`;
  isPrivate(await d(button(`bomb:${id}`, A)), "only the host can move you");
  assert.equal((await entry(sql, id, A)).status, "signed");
});

test("Bombers: a seated player moving to Bombers frees the seat for the waitlist, and the promotion is announced", async () => {
  const { sql, id, d, p1 } = await setup();
  await claimSlot(sql, { contentId: id, slotId: p1[0]!, userId: A, guildId: G, now: NOW });
  await joinWaitlist(sql, { contentId: id, userId: B, guildId: G, role: "Tank", now: NOW, party: 1 });
  const r: any = await d(button(`bomb:${id}`, A));
  assert.equal(r.type, 7);
  assert.equal((await entry(sql, id, A)).status, "bomber");
  assert.equal((await entry(sql, id, B)).slot_id, p1[0]);
  const announced = posts.find((p) => JSON.stringify(p.body).includes(B));
  assert.ok(announced, JSON.stringify(posts));
  assert.deepEqual(announced!.body.allowed_mentions, { users: [B] });
});

test("a click on a stale message of a one-message CTA answers with the moved note, and the roster is edited", async () => {
  const { sql, id, d } = await setup();
  const r: any = await d(button(`bomb:${id}`, A, "old-party-2"));
  assert.equal((await entry(sql, id, A)).status, "bomber");
  assert.deepEqual(r.data, renderMovedNote());
  assert.ok(edits.some((e) => e.messageId === "m1" && JSON.stringify(e.body).includes("Bombers 1/2")), JSON.stringify(edits));
  // A seat path too.
  const v = await getRosterView(sql, id, NOW);
  const j: any = await d(menu(`join:${id}`, [v!.slots[1]!.id], B, "old-party-2"));
  assert.deepEqual(j.data, renderMovedNote());
});

// ---- group 3 is only for Remove and Attendance ----

test("every control other than Remove and Attendance answers group 3 as not valid", async () => {
  const { id, d, p1 } = await setup();
  const cases: Interaction[] = [
    menu(`join:${id}@3`, [p1[0]], A), menu(`wait:${id}@3`, ["Tank"], A), menu(`fp:${id}@3`, ["any"], A),
    button(`leave:${id}@3`, A), button(`tent:${id}@3`, A), button(`fa:g:${id}@3`), button(`dt:g:${id}@3`),
    button(`sw:g:${id}@3`), button(`me:pp:${id}@3`, A), button(`bomb:${id}@3`, A),
  ];
  for (const c of cases) {
    const r: any = await d(c);
    assert.ok(text(r).includes("not valid"), `${(c.data as any).custom_id}: ${text(r)}`);
  }
});

test("Remove and Attendance refuse group 3 when the content has no Bombers", async () => {
  const s = await setup({ bombers: null });
  isPrivate(await s.d(button(`rm:g:${s.id}@3`)), "not valid");
  s.setNow(AFTER);
  isPrivate(await s.d(button(`att:g:${s.id}@3`)), "not valid");
});

// ---- Remove player ----

test("Remove player: with Bombers the party choice gets 💣 Bombers, which lists and removes bombers", async () => {
  const { sql, id, d, bomb } = await setup();
  await bomb(A);
  const r1: any = await d(button(`rm:${id}`));
  assert.deepEqual(choice(r1), [["Party 1", null, `rm:g:${id}`], ["Party 2", null, `rm:g:${id}@2`], ["Bombers", "💣", `rm:g:${id}@3`]]);
  const r2: any = await d(button(`rm:g:${id}@3`));
  assert.equal(r2.type, 7);
  const sel = r2.data.components[0].components[0];
  assert.equal(sel.custom_id, `rm:p:${id}@3`);
  assert.deepEqual(sel.options.map((o: any) => [o.value, o.description]), [[A, "Bomber"]]);
  const ok: any = await d(menu(`rm:p:${id}@3`, [A]));
  assert.ok(text(ok).includes("removed"), text(ok));
  assert.equal(await entry(sql, id, A), undefined);
  const removed = posts.find((p) => JSON.stringify(p.body).includes("was removed"));
  assert.deepEqual(removed!.body.allowed_mentions, { users: [A] });
});

test("Remove player: a one-party CTA with Bombers asks Party 1 or Bombers; a bomber is not in Party 1's list", async () => {
  const { sql, id, d, p1, bomb } = await setup({ parties: 1 });
  await claimSlot(sql, { contentId: id, slotId: p1[0]!, userId: B, guildId: G, now: NOW });
  await bomb(A);
  const r1: any = await d(button(`rm:${id}`));
  assert.deepEqual(choice(r1), [["Party 1", null, `rm:g:${id}`], ["Bombers", "💣", `rm:g:${id}@3`]]);
  const party1: any = await d(button(`rm:g:${id}`));
  assert.deepEqual(party1.data.components[0].components[0].options.map((o: any) => o.value), [B]);
  const no: any = await d(menu(`rm:p:${id}`, [A]));
  assert.ok(text(no).includes("not on the roster"));
  await sql`delete from signup where content_id = ${id}`;
  const empty: any = await d(button(`rm:${id}`));
  assert.ok(text(empty).includes("Nobody is signed up"));
});

test("Remove player: an empty Bombers list says so; a list over 25 shows 25 and says how many more", async () => {
  const { sql, id, d } = await setup({ bombers: 20 });
  const r0: any = await d(button(`rm:g:${id}@3`));
  assert.ok(text(r0).includes("Nobody is in Bombers"), text(r0));
  // Bombers are capped at 20, so a long list is a party's: 27 people waiting in party 1.
  for (let n = 0; n < 27; n++) {
    await sql`insert into signup (guild_id, content_id, user_id, slot_id, status, wait_role, party)
      values (${G}, ${id}, ${`2000000000000000${String(n).padStart(2, "0")}`}, null, 'waitlist', 'Tank', 1)`;
  }
  const r: any = await d(button(`rm:g:${id}`));
  assert.equal(r.data.components[0].components[0].options.length, 25);
  assert.ok(text(r).includes("2 more"), text(r));
});

// ---- Attendance ----

async function attendanceSetup(o: Opts = {}) {
  const s = await setup(o);
  if ((o.parties ?? 2) === 2) await claimSlot(s.sql, { contentId: s.id, slotId: s.p2[0]!, userId: C, guildId: G, now: NOW });
  await claimSlot(s.sql, { contentId: s.id, slotId: s.p1[0]!, userId: A, guildId: G, now: NOW });
  s.setNow(AFTER);
  return s;
}
const marks = async (sql: any, id: string) => Object.fromEntries((await sql`select user_id, status from attendance where content_id = ${id}`).map((r: any) => [r.user_id, r.status]));

test("Attendance: with Bombers the choice gets 💣 Bombers; the Bombers form lists only bombers", async () => {
  const s = await attendanceSetup();
  await s.bomb(B);
  const r: any = await s.d(button(`att:open:${s.id}`));
  assert.deepEqual(choice(r), [["Party 1", null, `att:g:${s.id}`], ["Party 2", null, `att:g:${s.id}@2`], ["Bombers", "💣", `att:g:${s.id}@3`]]);
  const f: any = await s.d(button(`att:g:${s.id}@3`));
  const sel = f.data.components[0].components[0];
  assert.equal(sel.custom_id, `att:pick:${s.id}@3`);
  assert.deepEqual(sel.options.map((o: any) => o.value), [B]);
  assert.ok(flatComponents(f.data).some((c: any) => c.label === "Submit Bombers"));
  const p1: any = await s.d(button(`att:g:${s.id}`));
  assert.deepEqual(p1.data.components[0].components[0].options.map((o: any) => o.value), [A]);
  isPrivate(await s.d(menu(`att:pick:${s.id}@3`, [A])), "out of date");
});

test("Attendance: Bombers is a third group for submitted; the report posts once every group is submitted", async () => {
  const s = await attendanceSetup();
  await s.bomb(B);
  await s.bomb(D);
  await s.d(menu(`att:pick:${s.id}@3`, [B]));
  const r3: any = await s.d(button(`att:submit:${s.id}@3`));
  assert.ok(text(r3).includes("Bombers submitted") && text(r3).includes("Party 1") && text(r3).includes("Party 2"), text(r3));
  assert.deepEqual(await marks(s.sql, s.id), { [B]: "attended", [D]: "no_show" });
  assert.deepEqual((await s.sql`select attendance_parties_submitted from content where id = ${s.id}`)[0]!.attendance_parties_submitted.map(Number), [3]);
  await s.d(button(`att:submit:${s.id}`));
  assert.equal(posts.length, 0);
  const last: any = await s.d(button(`att:submit:${s.id}@2`));
  assert.ok(text(last).includes("report is posted"), text(last));
  assert.equal(posts.length, 1);
  for (const u of [A, B, C, D]) assert.ok(posts[0]!.body.content.includes(u));
});

test("Attendance: an empty Bombers list counts as submitted", async () => {
  const s = await attendanceSetup();
  await s.d(button(`att:submit:${s.id}`));
  const r: any = await s.d(button(`att:submit:${s.id}@2`));
  assert.ok(text(r).includes("report is posted"), text(r));
  assert.equal(posts.length, 1);
});

test("Attendance: Bombers still to do is named when the parties are submitted first", async () => {
  const s = await attendanceSetup({ parties: 1 });
  await s.bomb(B);
  const open: any = await s.d(button(`att:open:${s.id}`));
  assert.deepEqual(choice(open), [["Party 1", null, `att:g:${s.id}`], ["Bombers", "💣", `att:g:${s.id}@3`]]);
  const r: any = await s.d(button(`att:submit:${s.id}`));
  assert.ok(text(r).includes("Party 1 submitted") && text(r).includes("Still to do: Bombers"), text(r));
  assert.equal(posts.length, 0);
  await s.d(button(`att:submit:${s.id}@3`));
  assert.equal(posts.length, 1);
});

test("Attendance: a bomber's attendance counts in history; an unmarked bomber is not recorded", async () => {
  const s = await attendanceSetup();
  await s.bomb(B);
  await s.bomb(D);
  await s.d(menu(`att:pick:${s.id}@3`, [B]));
  await s.sql`update content set status = 'done' where id = ${s.id}`;
  assert.deepEqual(await memberHistory(s.sql, G, B), { attended: 1, noShow: 0, notRecorded: 0 });
  assert.deepEqual(await memberHistory(s.sql, G, D), { attended: 0, noShow: 0, notRecorded: 1 });
  const a = (await getAttendance(s.sql, s.id))!;
  assert.deepEqual(a.players.filter((p) => p.bomber).map((p) => p.userId), [B, D]);
});

// ---- Ping, Leave, Tentative, vote, reminders, statistics ----

test("Ping includes bombers", async () => {
  const { sql, id, bomb, view } = await setup();
  await bomb(A);
  assert.deepEqual(await pingTargets(sql, id, OWNER), [A]);
  assert.equal((await view()).pingLeft, 1);
});

test("Leave removes a bomber; Tentative marks one with ❓", async () => {
  const { sql, id, d, bomb } = await setup();
  await bomb(A);
  await bomb(B);
  const t: any = await d(button(`tent:${id}`, B));
  assert.equal(t.type, 7);
  assert.ok(text(t).includes(`<@${B}> ❓`), text(t));
  const l: any = await d(button(`leave:${id}`, A));
  assert.equal(l.type, 7);
  assert.equal(await entry(sql, id, A), undefined);
  assert.ok(text(l).includes("Bombers 1/2"));
});

test("a bomber can vote on loot, gets the reminder, and counts in statistics", async () => {
  const { sql, id, bomb, deps } = await setup();
  await bomb(A);
  await sql`update content set reminder_sent_at = null where id = ${id}`;
  assert.equal(await castVote(sql, { contentId: id, userId: A, guildId: G, choice: "split", now: NOW }), "recorded");
  await sendReminders({ ...deps, now: () => new Date(START.getTime() - 20 * 60000) });
  assert.ok(posts.some((p) => p.body.allowed_mentions?.users?.includes(A)), JSON.stringify(posts));
  const stats = await getStats(sql, G, NOW);
  assert.equal(stats.all.participants, 1);
  assert.deepEqual(stats.topPlayers, [{ userId: A, count: 1 }]);
});

test("content with only bombers still gets the owner's attendance DM", async () => {
  const { sql, id, bomb, deps } = await setup();
  await bomb(A);
  assert.equal(await sendAttendanceDms({ ...deps, now: () => AFTER }), 1);
  assert.notEqual((await sql`select attendance_dm_sent_at from content where id = ${id}`)[0]!.attendance_dm_sent_at, null);
});

test("a tentative bomber still counts as a bomber in setTentative", async () => {
  const { sql, id, bomb } = await setup();
  await bomb(A);
  assert.deepEqual(await setTentative(sql, { contentId: id, guildId: G, userId: A }), { result: "ok", tentative: true });
});
