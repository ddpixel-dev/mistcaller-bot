import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView } from "../../src/db/content.ts";
import { assignPlayer, claimSlot, joinFill, joinWaitlist, leaveContent } from "../../src/db/signup.ts";
import { updateContentSettings } from "../../src/db/manage.ts";
import type { FillPref } from "../../src/domain/fillmatch.ts";

const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 60 * 60000);
const G = "g1";
const [A, B, C, OWNER] = ["100000000000000001", "100000000000000002", "100000000000000003", "100000000000000009"];
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup(selection = true, thread = "t1") {
  const sql = await testSql();
  const id = await createContent(sql, {
    guildId: G, threadId: thread, type: "pvp", title: "Selected", notes: null, startsAt: START, tier: "T8", hasLoot: false, createdBy: OWNER, now: NOW, selection,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "" }, { role: "DPS", weapon: "Bow" }],
  });
  const view = () => getRosterView(sql, id, NOW).then((v) => v!);
  return { sql, id, slots: (await view()).slots.map((s) => s.id), view };
}
const claim = (sql: any, id: string, slotId: string, userId: string) => claimSlot(sql, { contentId: id, slotId, userId, guildId: G, now: NOW });
const apply = (sql: any, id: string, userId: string, pref?: FillPref) => joinFill(sql, { contentId: id, userId, guildId: G, now: NOW, ...(pref ? { pref } : {}) });

test("content remembers that it is a selection event", async () => {
  const { view } = await setup();
  assert.equal((await view()).selection, true);
  const plain = await setup(false, "t2");
  assert.equal((await plain.view()).selection, false);
});

test("picking a position applies for it: no seat is taken, several players may apply for one, the roster lists them", async () => {
  const { sql, id, slots, view } = await setup();
  assert.equal(await claim(sql, id, slots[0]!, A), "applied");
  assert.equal(await claim(sql, id, slots[0]!, B), "applied");
  assert.equal(await claim(sql, id, slots[0]!, A), "unchanged");
  const v = await view();
  assert.equal(v.slots.filter((s) => s.userId).length, 0, "nobody is seated");
  assert.deepEqual(v.applicants!.map((a) => [a.userId, a.wants]), [[A, "#1"], [B, "#1"]]);
  assert.equal(await claim(sql, id, slots[2]!, A), "applied", "changing the position changes the application");
  assert.deepEqual((await view()).applicants!.map((a) => [a.userId, a.wants]), [[A, "#3"], [B, "#1"]].sort(), "A keeps a single application");
});

test("Fill in a selection event is an application for what the player can play", async () => {
  const { sql, id, view } = await setup();
  assert.deepEqual(await apply(sql, id, A), { result: "applied" });
  assert.deepEqual(await apply(sql, id, A), { result: "unchanged" });
  assert.deepEqual(await apply(sql, id, B, { any: false, roles: ["Healer", "Tank"], slotIds: [] }), { result: "applied" });
  const v = await view();
  assert.deepEqual(v.applicants!.map((a) => [a.userId, a.wants]), [[A, "Any"], [B, "Healer, Tank"]]);
  assert.deepEqual(v.fills, [], "an application is not a waiting fill");
  assert.equal(v.slots.filter((s) => s.userId).length, 0);
});

test("the host accepts by placing the player; the application is gone and a seated player cannot move themselves", async () => {
  const { sql, id, slots, view } = await setup();
  await claim(sql, id, slots[1]!, A);
  const r = await assignPlayer(sql, { contentId: id, guildId: G, userId: A, slotId: slots[1]!, now: NOW });
  assert.equal(r.result, "ok");
  const v = await view();
  assert.equal(v.slots[1]!.userId, A);
  assert.deepEqual(v.applicants, []);
  assert.equal(await claim(sql, id, slots[2]!, A), "selected", "the host decides who moves");
  assert.deepEqual(await apply(sql, id, A), { result: "selected" });
  assert.equal((await view()).slots[1]!.userId, A, "still seated");
});

test("leaving withdraws an application; a freed seat is not given to an applicant; the waitlist is not used", async () => {
  const { sql, id, slots, view } = await setup();
  await assignPlayer(sql, { contentId: id, guildId: G, userId: B, slotId: slots[0]!, now: NOW });
  await claim(sql, id, slots[0]!, A);
  await claim(sql, id, slots[2]!, C);
  const promoted: any[] = [];
  assert.equal(await leaveContent(sql, { contentId: id, userId: B, guildId: G, now: NOW, promoted }), "left");
  assert.deepEqual(promoted, [], "the host picks, nothing is automatic");
  assert.equal((await view()).slots[0]!.userId, null);
  assert.equal(await leaveContent(sql, { contentId: id, userId: C, guildId: G, now: NOW }), "left");
  assert.deepEqual((await view()).applicants!.map((a) => a.userId), [A]);
  assert.equal(await joinWaitlist(sql, { contentId: id, userId: B, guildId: G, role: "Tank", now: NOW }), "selection");
});

test("turning selection on turns waiting fills and waiters into applicants; turning it off needs no applicants left", async () => {
  const { sql, id, slots, view } = await setup(false);
  for (const [n, u] of [[0, A], [1, B], [2, C]] as const) await claim(sql, id, slots[n]!, u);
  await joinFill(sql, { contentId: id, userId: OWNER, guildId: G, now: NOW, pref: { any: false, roles: ["Scout"], slotIds: [] } });
  await joinWaitlist(sql, { contentId: id, userId: "100000000000000008", guildId: G, role: "Tank", now: NOW });
  assert.equal(await updateContentSettings(sql, id, { selection: true }), "ok");
  const v = await view();
  assert.equal(v.selection, true);
  assert.deepEqual(v.slots.map((s) => s.userId), [A, B, C], "seated players keep their seats");
  assert.deepEqual(v.applicants!.map((a) => [a.userId, a.wants]), [[OWNER, "Scout"], ["100000000000000008", "Tank"]]);
  assert.deepEqual([v.fills, v.waitlist], [[], []]);
  assert.equal(await updateContentSettings(sql, id, { selection: false }), "has_applicants");
  assert.equal((await view()).selection, true, "nothing changed");
  await leaveContent(sql, { contentId: id, userId: OWNER, guildId: G });
  await leaveContent(sql, { contentId: id, userId: "100000000000000008", guildId: G });
  assert.equal(await updateContentSettings(sql, id, { selection: false }), "ok");
  assert.equal((await view()).selection, false);
});
