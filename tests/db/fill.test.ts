import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView } from "../../src/db/content.ts";
import { assignFill, chooseWeapon, claimSlot, joinFill, joinWaitlist, leaveContent } from "../../src/db/signup.ts";
import { castVote } from "../../src/db/vote.ts";
import { cancelContent, editContent } from "../../src/db/manage.ts";
import { getAttendance, memberHistory, setAttended, submitAttendance } from "../../src/db/attendance.ts";
import { sendReminders } from "../../src/jobs/cron.ts";
import type { Deps } from "../../src/discord/dispatch.ts";

const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 40 * 60000);
const G = "g1";
const [A, B, C, D, OWNER] = ["100000000000000001", "100000000000000002", "100000000000000003", "100000000000000004", "100000000000000009"];
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup(over: { hasLoot?: boolean } = {}) {
  const sql = await testSql();
  const id = await createContent(sql, {
    guildId: G, threadId: "t1", type: "pvp", title: "Raid", notes: null, startsAt: START, tier: "T8", hasLoot: over.hasLoot ?? false,
    createdBy: OWNER, now: NOW,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "" }, { role: "DPS", weapon: "Bow" }, { role: "DPS", weapon: "" }],
  });
  const view = (await getRosterView(sql, id, NOW))!;
  return { sql, id, slots: view.slots.map((s) => s.id), view: () => getRosterView(sql, id, NOW).then((v) => v!) };
}
const claim = (sql: any, id: string, slotId: string, userId: string) => claimSlot(sql, { contentId: id, slotId, userId, guildId: G, now: NOW });
const fill = (sql: any, id: string, userId: string, promoted?: any[]) => joinFill(sql, { contentId: id, userId, guildId: G, now: NOW, promoted });

test("a fill is listed oldest first, counts once, and a second press changes nothing", async () => {
  const { sql, id, view } = await setup();
  assert.equal(await fill(sql, id, A), "claimed");
  assert.equal(await fill(sql, id, B), "claimed");
  assert.equal(await fill(sql, id, A), "unchanged");
  assert.deepEqual((await view()).fills, [A, B]);
  assert.equal((await view()).slots.filter((s) => s.userId).length, 0, "a fill takes no position");
});

test("a seated member who becomes a fill frees the position, and the waitlist moves up", async () => {
  const { sql, id, slots, view } = await setup();
  await claim(sql, id, slots[0]!, A);
  assert.equal(await joinWaitlist(sql, { contentId: id, userId: B, guildId: G, role: "Tank", now: NOW }), "ok");
  const promoted: any[] = [];
  assert.equal(await fill(sql, id, A, promoted), "moved");
  assert.deepEqual(promoted.map((p) => p.userId), [B]);
  const v = await view();
  assert.equal(v.slots[0]!.userId, B);
  assert.deepEqual(v.fills, [A]);
});

test("a waitlisted member can become a fill, and a fill can take a position like anyone", async () => {
  const { sql, id, slots, view } = await setup();
  for (const s of [slots[0]!]) await claim(sql, id, s, A);
  await joinWaitlist(sql, { contentId: id, userId: B, guildId: G, role: "Tank", now: NOW });
  assert.equal(await fill(sql, id, B), "claimed");
  assert.equal((await view()).waitlist!.length, 0);
  assert.equal(await claim(sql, id, slots[2]!, B), "claimed");
  const v = await view();
  assert.deepEqual(v.fills, []);
  assert.equal(v.slots[2]!.userId, B);
});

test("fills are refused when signups are locked, and for another server", async () => {
  const { sql, id } = await setup();
  assert.equal(await joinFill(sql, { contentId: id, userId: A, guildId: "other", now: NOW }), "not_found");
  await sql`update content set status = 'locked'`;
  assert.equal(await fill(sql, id, A), "locked");
  await sql`update content set status = 'open'`;
  assert.equal(await joinFill(sql, { contentId: id, userId: A, guildId: G, now: new Date(START.getTime() + 1000) }), "locked");
});

test("leaving removes a fill, and its vote", async () => {
  const { sql, id } = await setup({ hasLoot: true });
  await fill(sql, id, A);
  assert.equal(await castVote(sql, { contentId: id, userId: A, guildId: G, choice: "split", now: NOW }), "recorded");
  assert.equal(await leaveContent(sql, { contentId: id, userId: A, guildId: G, now: NOW }), "left");
  assert.equal((await sql`select 1 from vote`).length, 0);
  assert.deepEqual((await sql`select 1 from signup`).length, 0);
});

test("assigning places a fill in an open position, by id or by number, in one step", async () => {
  const { sql, id, slots, view } = await setup();
  await fill(sql, id, A);
  await fill(sql, id, B);
  assert.deepEqual(await assignFill(sql, { contentId: id, guildId: G, userId: A, slotId: slots[2]! }), { result: "ok", position: 3, role: "DPS" });
  assert.deepEqual(await assignFill(sql, { contentId: id, guildId: G, userId: B, position: 1 }), { result: "ok", position: 1, role: "Tank" });
  const v = await view();
  assert.deepEqual(v.fills, []);
  assert.equal(v.slots[2]!.userId, A);
  assert.equal(v.slots[0]!.userId, B);
});

test("assigning refuses a taken position, a member who is not a fill, an unknown position, another server and finished content", async () => {
  const { sql, id, slots } = await setup();
  await claim(sql, id, slots[0]!, C);
  await fill(sql, id, A);
  assert.equal((await assignFill(sql, { contentId: id, guildId: G, userId: A, position: 1 })).result, "taken");
  assert.equal((await assignFill(sql, { contentId: id, guildId: G, userId: D, position: 2 })).result, "not_fill");
  assert.equal((await assignFill(sql, { contentId: id, guildId: G, userId: C, position: 2 })).result, "not_fill", "a seated member is not a fill");
  assert.equal((await assignFill(sql, { contentId: id, guildId: G, userId: A, position: 9 })).result, "no_slot");
  assert.equal((await assignFill(sql, { contentId: id, guildId: "other", userId: A, position: 2 })).result, "not_found");
  assert.equal((await sql`select status from signup where user_id = ${A}`)[0]!.status, "fill", "nothing changed");
  await sql`update content set status = 'locked'`;
  assert.equal((await assignFill(sql, { contentId: id, guildId: G, userId: A, position: 2 })).result, "ok", "allowed while locked");
  await sql`update content set status = 'done'`;
  await fill(sql, id, D).catch(() => null);
  assert.equal((await assignFill(sql, { contentId: id, guildId: G, userId: A, position: 3 })).result, "unavailable");
});

test("two owners assigning two fills to the same position: exactly one wins", async () => {
  const { sql, id, view } = await setup();
  await fill(sql, id, A);
  await fill(sql, id, B);
  const results = await Promise.all([
    assignFill(sql, { contentId: id, guildId: G, userId: A, position: 1 }),
    assignFill(sql, { contentId: id, guildId: G, userId: B, position: 1 }),
  ]);
  assert.deepEqual(results.map((r) => r.result).sort(), ["ok", "taken"]);
  const v = await view();
  assert.equal(v.fills!.length, 1);
  assert.ok(v.slots[0]!.userId);
});

test("the player's own weapon: chosen on a slot without one, kept between such slots, cleared otherwise", async () => {
  const { sql, id, slots, view } = await setup();
  await claim(sql, id, slots[1]!, A); // Healer, no weapon
  assert.equal(await chooseWeapon(sql, { contentId: id, guildId: G, userId: A, weapon: "Holy Staff" }), "ok");
  assert.equal((await view()).slots[1]!.chosenWeapon, "Holy Staff");
  assert.equal(await claim(sql, id, slots[3]!, A), "moved"); // DPS, no weapon: keeps it
  let v = await view();
  assert.equal(v.slots[3]!.chosenWeapon, "Holy Staff");
  assert.equal(await claim(sql, id, slots[0]!, A), "moved"); // Tank with Mace: cleared
  assert.equal((await sql`select chosen_weapon from signup where user_id = ${A}`)[0]!.chosen_weapon, null);
  assert.equal(await chooseWeapon(sql, { contentId: id, guildId: G, userId: A, weapon: "Bow" }), "has_weapon");
  assert.equal(await chooseWeapon(sql, { contentId: id, guildId: G, userId: B, weapon: "Bow" }), "not_signed");
  await fill(sql, id, C);
  assert.equal(await chooseWeapon(sql, { contentId: id, guildId: G, userId: C, weapon: "Bow" }), "not_signed", "a fill has no slot");
  assert.equal(await chooseWeapon(sql, { contentId: id, guildId: "other", userId: A, weapon: "Bow" }), "not_found");
  await sql`update content set status = 'cancelled'`;
  assert.equal(await chooseWeapon(sql, { contentId: id, guildId: G, userId: A, weapon: "Bow" }), "unavailable");
  v = await view();
  assert.equal(v.slots[0]!.chosenWeapon, null);
});

test("a fill counts as signed up for voting, attendance, history, reminders, edit and cancel notices", async () => {
  const { sql, id, slots } = await setup({ hasLoot: true });
  await claim(sql, id, slots[0]!, A);
  await fill(sql, id, B);

  assert.equal(await castVote(sql, { contentId: id, userId: B, guildId: G, choice: "regear", now: NOW }), "recorded");
  assert.equal(await castVote(sql, { contentId: id, userId: D, guildId: G, choice: "regear", now: NOW }), "not_signed");

  const a = await getAttendance(sql, id);
  assert.deepEqual(a!.players.map((p) => [p.userId, p.position, p.fill]), [[A, 1, false], [B, null, true]]);
  assert.equal(await setAttended(sql, { contentId: id, userIds: [B], markedBy: OWNER, now: NOW }), "ok");
  assert.equal(await submitAttendance(sql, { contentId: id, markedBy: OWNER, now: NOW }), "ok");
  const marks = (await getAttendance(sql, id))!.marks;
  assert.deepEqual(marks, { [A]: "no_show", [B]: "attended" });
  assert.deepEqual(await memberHistory(sql, G, B), { attended: 1, noShow: 0, notRecorded: 0 });

  const posts: { channel: string; body: any }[] = [];
  const deps: Deps = { sql, now: () => new Date(START.getTime() - 20 * 60000), rest: { async createMessage(channel, body) { posts.push({ channel, body }); return { id: "x" }; }, async editMessage() {}, async deleteMessage() {} } };
  assert.equal(await sendReminders(deps), 1);
  assert.ok(posts[0]!.body.content.includes(`<@${A}>`) && posts[0]!.body.content.includes(`<@${B}>`), "the reminder names the fill too");

  const edited = await editContent(sql, id, { title: "Raid", notes: null, startsAt: new Date(START.getTime() + 3600000), tier: "T8", hasLoot: null, kind: null, slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "" }, { role: "DPS", weapon: "Bow" }, { role: "DPS", weapon: "" }] }, NOW);
  assert.ok(edited.result === "ok" && edited.notify.includes(B));
  const cancelled = await cancelContent(sql, id);
  assert.ok(cancelled.result === "ok" && cancelled.notify.includes(B));
});
