import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView } from "../../src/db/content.ts";
import { assignPlayer, chooseWeapon, claimSlot, joinFill, joinWaitlist, leaveContent } from "../../src/db/signup.ts";
import { castVote } from "../../src/db/vote.ts";
import { cancelContent, editContent } from "../../src/db/manage.ts";
import { getAttendance, memberHistory, setAttended, submitAttendance } from "../../src/db/attendance.ts";
import { sendReminders } from "../../src/jobs/cron.ts";
import type { Deps } from "../../src/discord/dispatch.ts";
import { ANY_FILL, type FillPref } from "../../src/domain/fillmatch.ts";

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
const fill = (sql: any, id: string, userId: string, promoted?: any[], pref?: FillPref) => joinFill(sql, { contentId: id, userId, guildId: G, now: NOW, promoted, ...(pref ? { pref } : {}) });
const prefOf = (over: Partial<FillPref>): FillPref => ({ any: false, roles: [], slotIds: [], ...over });
// A fill whose choices match no position on this roster, so it waits (FR-057).
const waitingFill = (sql: any, id: string, userId: string, promoted?: any[]) => fill(sql, id, userId, promoted, prefOf({ roles: ["Nobody"] }));

test("a fill is seated at once in the best open position: a healer first, and nothing is held back", async () => {
  const { sql, id, slots, view } = await setup(); // Tank, Healer, DPS, DPS
  const r = await fill(sql, id, A);
  assert.deepEqual(r, { result: "seated", slot: { id: slots[1], position: 2, role: "Healer", weapon: "" } });
  assert.equal((await fill(sql, id, B)).result, "seated");
  const v = await view();
  assert.deepEqual(v.slots.map((s) => s.userId), [B, A, null, null], "the second Any fill takes the Tank, then DPS");
  assert.deepEqual(v.fills, []);
});

test("a fill whose choices match nothing open waits, oldest first; the same choices again change nothing", async () => {
  const { sql, id, view } = await setup();
  assert.deepEqual(await waitingFill(sql, id, A), { result: "waiting" });
  assert.deepEqual(await waitingFill(sql, id, B), { result: "waiting" });
  assert.deepEqual(await waitingFill(sql, id, A), { result: "unchanged" });
  const v = await view();
  assert.deepEqual(v.fills, [A, B]);
  assert.equal(v.slots.filter((s) => s.userId).length, 0);
});

test("changing a waiting fill's choices re-checks the open positions at once", async () => {
  const { sql, id, view } = await setup();
  await waitingFill(sql, id, A);
  assert.equal((await fill(sql, id, A, undefined, ANY_FILL)).result, "seated");
  assert.deepEqual((await view()).fills, []);
});

test("chosen roles and chosen positions: only a matching position is taken, and an Any fill still prefers healers", async () => {
  const { sql, id, slots, view } = await setup();
  const dps = await fill(sql, id, A, undefined, prefOf({ roles: ["dps"] }));
  assert.deepEqual([dps.result, (dps as any).slot.position], ["seated", 3]);
  const chosen = await fill(sql, id, B, undefined, prefOf({ slotIds: [slots[3]!, slots[0]!] }));
  assert.deepEqual([chosen.result, (chosen as any).slot.position], ["seated", 1], "the lower of the chosen positions");
  assert.equal((await fill(sql, id, C, undefined, prefOf({ slotIds: [slots[0]!] }))).result, "waiting", "that position is taken");
  assert.deepEqual((await view()).fills, [C]);
});

test("a waiting fill is seated, in join order, when a position they chose frees up, and the announcement knows they were a fill", async () => {
  const { sql, id, slots, view } = await setup();
  await claim(sql, id, slots[0]!, A);
  await fill(sql, id, B, undefined, prefOf({ slotIds: [slots[0]!] }));
  assert.equal(await joinWaitlist(sql, { contentId: id, userId: C, guildId: G, role: "Tank", now: NOW }), "ok");
  const promoted: any[] = [];
  assert.equal(await leaveContent(sql, { contentId: id, userId: A, guildId: G, now: NOW, promoted }), "left");
  assert.deepEqual(promoted.map((p) => [p.userId, p.position, !!p.fillWanted]), [[B, 1, true]], "B asked first");
  const v = await view();
  assert.equal(v.slots[0]!.userId, B);
  assert.deepEqual([v.fills, v.waitlist!.map((w) => w.userId)], [[], [C]]);
});

test("an earlier waiter keeps their place before a later Any fill, and a fill is seated before a later waiter", async () => {
  const { sql, id, slots } = await setup();
  for (const [n, u] of [[0, A], [1, B], [2, C], [3, D]] as const) await claim(sql, id, slots[n]!, u);
  await joinWaitlist(sql, { contentId: id, userId: OWNER, guildId: G, role: "Tank", now: NOW });
  await fill(sql, id, "100000000000000005");
  const promoted: any[] = [];
  await leaveContent(sql, { contentId: id, userId: A, guildId: G, now: NOW, promoted });
  assert.deepEqual(promoted.map((p) => p.userId), [OWNER], "the Tank waiter was first");
  const second: any[] = [];
  await leaveContent(sql, { contentId: id, userId: B, guildId: G, now: NOW, promoted: second });
  assert.deepEqual(second.map((p) => [p.userId, p.position]), [["100000000000000005", 2]], "then the fill takes the freed healer");
});

test("a seated member who becomes a fill frees the position, and the waitlist moves up", async () => {
  const { sql, id, slots, view } = await setup();
  await claim(sql, id, slots[0]!, A);
  await claim(sql, id, slots[1]!, C);
  await claim(sql, id, slots[2]!, D);
  await claim(sql, id, slots[3]!, OWNER);
  assert.equal(await joinWaitlist(sql, { contentId: id, userId: B, guildId: G, role: "Tank", now: NOW }), "ok");
  const promoted: any[] = [];
  const r = await fill(sql, id, A, promoted, prefOf({ roles: ["Nobody"] }));
  assert.deepEqual(r, { result: "waiting" });
  assert.deepEqual(promoted.map((p) => p.userId), [B]);
  const v = await view();
  assert.equal(v.slots[0]!.userId, B);
  assert.deepEqual(v.fills, [A]);
});

test("a waitlisted member can become a fill, and a fill can take a position like anyone", async () => {
  const { sql, id, slots, view } = await setup();
  for (const [n, u] of [[0, A], [1, C], [2, D], [3, OWNER]] as const) await claim(sql, id, slots[n]!, u);
  await joinWaitlist(sql, { contentId: id, userId: B, guildId: G, role: "Tank", now: NOW });
  assert.deepEqual(await waitingFill(sql, id, B), { result: "waiting" });
  assert.equal((await view()).waitlist!.length, 0);
  await leaveContent(sql, { contentId: id, userId: D, guildId: G });
  assert.equal(await claim(sql, id, slots[2]!, B), "claimed");
  const v = await view();
  assert.deepEqual(v.fills, []);
  assert.equal(v.slots[2]!.userId, B);
});

test("fills are refused when signups are locked or for another server, and accepted after the start while open", async () => {
  const { sql, id } = await setup();
  assert.equal((await joinFill(sql, { contentId: id, userId: A, guildId: "other", now: NOW })).result, "not_found");
  await sql`update content set status = 'locked'`;
  assert.equal((await fill(sql, id, A)).result, "locked");
  await sql`update content set status = 'open'`;
  assert.equal((await joinFill(sql, { contentId: id, userId: A, guildId: G, now: new Date(START.getTime() + 1000) })).result, "seated", "open content takes a fill after the start");
});

test("leaving removes a fill, and its vote", async () => {
  const { sql, id } = await setup({ hasLoot: true });
  await waitingFill(sql, id, A);
  assert.equal(await castVote(sql, { contentId: id, userId: A, guildId: G, choice: "split", now: NOW }), "recorded");
  assert.equal(await leaveContent(sql, { contentId: id, userId: A, guildId: G, now: NOW }), "left");
  assert.equal((await sql`select 1 from vote`).length, 0);
  assert.deepEqual((await sql`select 1 from signup`).length, 0);
});

const assign = (sql: any, id: string, userId: string, at: { slotId?: string; position?: number }, over: { guildId?: string; promoted?: any[] } = {}) =>
  assignPlayer(sql, { contentId: id, guildId: over.guildId ?? G, userId, now: NOW, promoted: over.promoted, ...at });

test("assigning places a fill in an open position, by id or by number, in one step", async () => {
  const { sql, id, slots, view } = await setup();
  await waitingFill(sql, id, A);
  await waitingFill(sql, id, B);
  assert.deepEqual(await assign(sql, id, A, { slotId: slots[2]! }), { result: "ok", position: 3, role: "DPS" });
  assert.deepEqual(await assign(sql, id, B, { position: 1 }), { result: "ok", position: 1, role: "Tank" });
  const v = await view();
  assert.deepEqual(v.fills, []);
  assert.equal(v.slots[2]!.userId, A);
  assert.equal(v.slots[0]!.userId, B);
});

test("the host signs up any member: someone not on the roster, a waiting member, or a seated one who is moved", async () => {
  const { sql, id, slots, view } = await setup();
  assert.equal((await assign(sql, id, A, { position: 2 })).result, "ok", "a member not on the roster");
  await claim(sql, id, slots[0]!, B);
  await claim(sql, id, slots[2]!, C);
  await claim(sql, id, slots[3]!, D);
  assert.equal(await joinWaitlist(sql, { contentId: id, userId: "100000000000000005", guildId: G, role: "Tank", now: NOW }), "ok");
  // B moves from Tank (1) to... every position is taken, so free one first
  await leaveContent(sql, { contentId: id, userId: C, guildId: G });
  const promoted: any[] = [];
  assert.deepEqual(await assign(sql, id, B, { position: 3 }, { promoted }), { result: "ok", position: 3, role: "DPS" });
  assert.deepEqual(promoted.map((p) => [p.userId, p.position]), [["100000000000000005", 1]], "the freed Tank goes to the waitlist");
  const v = await view();
  assert.deepEqual(v.slots.map((s) => s.userId), ["100000000000000005", A, B, D]);
  assert.equal((await sql`select count(*)::int as n from signup where user_id = ${B}`)[0]!.n, 1, "never listed twice");
  assert.equal(v.waitlist!.length, 0);
  await joinWaitlist(sql, { contentId: id, userId: C, guildId: G, role: "Tank", now: NOW });
  await leaveContent(sql, { contentId: id, userId: D, guildId: G });
  assert.equal((await assign(sql, id, C, { position: 4 })).result, "ok", "a waiting member");
  const after = await view();
  assert.equal(after.slots[3]!.userId, C);
  assert.equal(after.waitlist!.length, 0);
  assert.equal((await sql`select wait_role from signup where user_id = ${C}`)[0]!.wait_role, null);
});

test("a host move clears the player's own weapon: the new position's weapon, or Player's choice (owner decision 2026-10-24)", async () => {
  const sql = await testSql();
  const id = await createContent(sql, {
    guildId: G, threadId: "t2", type: "pvp", title: "Raid", notes: null, startsAt: START, tier: "T8", hasLoot: false, createdBy: OWNER, now: NOW,
    slots: [{ role: "Tank", weapon: "" }, { role: "Healer", weapon: "" }, { role: "DPS", weapon: "Bow" }],
  });
  const v = (await getRosterView(sql, id, NOW))!;
  await claimSlot(sql, { contentId: id, slotId: v.slots[0]!.id, userId: A, guildId: G, now: NOW });
  assert.equal(await chooseWeapon(sql, { contentId: id, guildId: G, userId: A, weapon: "Mace" }), "ok");
  assert.equal((await assign(sql, id, A, { position: 2 })).result, "ok", "to another position without a weapon");
  let w = (await getRosterView(sql, id, NOW))!;
  assert.equal(w.slots[1]!.userId, A);
  assert.equal(w.slots[1]!.chosenWeapon ?? null, null, "the pick is cleared: the roster shows Player's choice");
  assert.equal(await chooseWeapon(sql, { contentId: id, guildId: G, userId: A, weapon: "Mace" }), "ok");
  assert.equal((await assign(sql, id, A, { position: 3 })).result, "ok", "to a position with a weapon");
  w = (await getRosterView(sql, id, NOW))!;
  assert.deepEqual([w.slots[2]!.userId, w.slots[2]!.weapon, w.slots[2]!.chosenWeapon ?? null], [A, "Bow", null]);
});

test("the host may place any member in an open position, whatever waiting fills are listed", async () => {
  const { sql, id, slots, view } = await setup();
  for (const [n, u] of [A, B].entries()) await claim(sql, id, slots[n]!, u);
  await waitingFill(sql, id, C);
  await waitingFill(sql, id, D);
  assert.equal((await assign(sql, id, "100000000000000005", { position: 3 })).result, "ok");
  const v = await view();
  assert.equal(v.slots[2]!.userId, "100000000000000005");
  assert.deepEqual(v.fills, [C, D]);
});

test("assigning refuses a taken position, the same position twice, an unknown position, another server and finished content", async () => {
  const { sql, id, slots } = await setup();
  await claim(sql, id, slots[0]!, C);
  await waitingFill(sql, id, A);
  assert.equal((await assign(sql, id, A, { position: 1 })).result, "taken");
  assert.equal((await assign(sql, id, C, { position: 1 })).result, "unchanged");
  assert.equal((await assign(sql, id, A, { position: 9 })).result, "no_slot");
  assert.equal((await assign(sql, id, A, { position: 2 }, { guildId: "other" })).result, "not_found");
  assert.equal((await sql`select status from signup where user_id = ${A}`)[0]!.status, "fill", "nothing changed");
  await sql`update content set status = 'locked'`;
  assert.equal((await assign(sql, id, A, { position: 2 })).result, "ok", "allowed while locked");
  await sql`update content set status = 'done'`;
  assert.equal((await assign(sql, id, D, { position: 3 })).result, "unavailable");
});

test("two owners assigning two members to the same position: exactly one wins", async () => {
  const { sql, id, view } = await setup();
  await waitingFill(sql, id, A);
  const results = await Promise.all([assign(sql, id, A, { position: 1 }), assign(sql, id, B, { position: 1 })]);
  assert.deepEqual(results.map((r) => r.result).sort(), ["ok", "taken"]);
  const v = await view();
  assert.ok(v.slots[0]!.userId);
  assert.equal((await sql`select count(*)::int as n from signup`)[0]!.n, v.fills!.length + 1, "the loser is not added");
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
  await waitingFill(sql, id, C);
  assert.equal(await chooseWeapon(sql, { contentId: id, guildId: G, userId: C, weapon: "Bow" }), "not_signed", "a waiting fill has no slot");
  assert.equal(await chooseWeapon(sql, { contentId: id, guildId: "other", userId: A, weapon: "Bow" }), "not_found");
  await sql`update content set status = 'cancelled'`;
  assert.equal(await chooseWeapon(sql, { contentId: id, guildId: G, userId: A, weapon: "Bow" }), "unavailable");
  v = await view();
  assert.equal(v.slots[0]!.chosenWeapon, null);
});

test("a fill counts as signed up for voting, attendance, history, reminders, edit and cancel notices", async () => {
  const { sql, id, slots } = await setup({ hasLoot: true });
  await claim(sql, id, slots[0]!, A);
  await waitingFill(sql, id, B);

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

// ---- FR-057: no reserved seats ----

test("nothing is held back for a waiting fill: the last open position can be taken, and a waiter is seated normally", async () => {
  const { sql, id, slots, view } = await setup();
  await waitingFill(sql, id, A);
  for (const [n, u] of [[0, B], [1, C], [2, D]] as const) assert.equal(await claim(sql, id, slots[n]!, u), "claimed");
  assert.equal(await claim(sql, id, slots[3]!, OWNER), "claimed", "no seat is reserved for the fill");
  assert.equal(await joinWaitlist(sql, { contentId: id, userId: "100000000000000005", guildId: G, role: "DPS", now: NOW }), "ok");
  const promoted: any[] = [];
  await leaveContent(sql, { contentId: id, userId: D, guildId: G, now: NOW, promoted });
  assert.deepEqual(promoted.map((p) => p.userId), ["100000000000000005"]);
  assert.deepEqual((await view()).fills, [A]);
});

test("adding a position in an edit seats a waiting fill whose choices match it", async () => {
  const { sql, id, view } = await setup();
  for (const u of [B, C, D, OWNER]) await fill(sql, id, u);
  await fill(sql, id, A, undefined, prefOf({ roles: ["Scout"] }));
  const edited = await editContent(sql, id, { title: "Raid", notes: null, startsAt: START, tier: "T8", hasLoot: null, kind: null, slots: [
    { role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "" }, { role: "DPS", weapon: "Bow" }, { role: "DPS", weapon: "" }, { role: "Scout", weapon: "Bow" },
  ] }, NOW);
  assert.ok(edited.result === "ok");
  assert.deepEqual((edited as any).promoted.map((p: any) => [p.userId, p.role, !!p.fillWanted]), [[A, "Scout", true]]);
  assert.deepEqual((await view()).fills, []);
});
