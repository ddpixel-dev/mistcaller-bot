import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView } from "../../src/db/content.ts";
import { assignPlayer, claimSlot, getEntryParty, joinBombers, joinFill, joinWaitlist, leaveContent, setTentative } from "../../src/db/signup.ts";
import { lockContent, cancelContent } from "../../src/db/manage.ts";

// FR-071: Bombers are a capped, slotless place. Moving in or out of it never leaves a double entry.
const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 60 * 60000);
const G = "g1";
const [A, B, C, D, OWNER] = ["100000000000000001", "100000000000000002", "100000000000000003", "100000000000000004", "100000000000000009"];
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup(opts: { bombers?: number | null; selection?: boolean; thread?: string } = {}) {
  const sql = await testSql();
  const id = await createContent(sql, {
    guildId: G, threadId: opts.thread ?? "t1", type: "pvp", title: "Roam", notes: null, startsAt: START, tier: "T8", hasLoot: false, createdBy: OWNER, now: NOW,
    selection: opts.selection ?? false, bombers: opts.bombers === undefined ? 2 : opts.bombers,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }],
  });
  const view = () => getRosterView(sql, id, NOW).then((v) => v!);
  const bomb = (userId: string, guildId = G) => joinBombers(sql, { contentId: id, guildId, userId, now: NOW });
  const claim = (slotId: string, userId: string) => claimSlot(sql, { contentId: id, slotId, userId, guildId: G, now: NOW });
  return { sql, id, slots: (await view()).slots.map((s) => s.id), view, bomb, claim };
}

test("joining Bombers lists the player; pressing again is already", async () => {
  const { bomb, view } = await setup();
  assert.deepEqual(await bomb(A), { result: "joined", promoted: [] });
  assert.equal((await bomb(A)).result, "already");
  assert.deepEqual((await view()).bomberIds, [A]);
});

test("the cap holds: full for the next player, and two at once for the last place give one joined and one full", async () => {
  const { bomb, view } = await setup({ bombers: 2 });
  await bomb(A);
  const results = (await Promise.all([bomb(B), bomb(C)])).map((r) => r.result).sort();
  assert.deepEqual(results, ["full", "joined"]);
  assert.equal((await view()).bomberIds.length, 2);
  assert.equal((await bomb(D)).result, "full");
  assert.equal((await bomb(A)).result, "already");
});

test("Bombers off, wrong guild and content that is not open are refused", async () => {
  const off = await setup({ bombers: null });
  assert.equal((await off.bomb(A)).result, "off");
  const on = await setup({ bombers: 2, thread: "t2" });
  assert.equal((await on.bomb(A, "other")).result, "unavailable");
  assert.equal((await joinBombers(on.sql, { contentId: "00000000-0000-0000-0000-000000000000", guildId: G, userId: A, now: NOW })).result, "unavailable");
  await lockContent(on.sql, on.id);
  assert.equal((await on.bomb(A)).result, "unavailable");
});

test("a cancelled content refuses Bombers", async () => {
  const { sql, id, bomb } = await setup();
  await cancelContent(sql, id);
  assert.equal((await bomb(A)).result, "unavailable");
});

test("moving from a seat to Bombers frees the seat and promotes the waitlist", async () => {
  const { sql, id, slots, view, bomb, claim } = await setup();
  await claim(slots[0]!, A);
  await joinWaitlist(sql, { contentId: id, userId: B, guildId: G, role: "Tank", now: NOW });
  const r = await bomb(A);
  assert.equal(r.result, "joined");
  assert.deepEqual(r.promoted.map((p) => p.userId), [B]);
  const v = await view();
  assert.deepEqual(v.bomberIds, [A]);
  assert.equal(v.slots[0]!.userId, B);
  assert.equal(await getEntryParty(sql, id, A), null);
});

test("from the waitlist or a fill into Bombers: one entry only", async () => {
  const { sql, id, slots, view, bomb, claim } = await setup();
  await claim(slots[0]!, C);
  await joinWaitlist(sql, { contentId: id, userId: A, guildId: G, role: "Tank", now: NOW });
  await joinFill(sql, { contentId: id, userId: B, guildId: G, now: NOW });
  await bomb(A);
  await bomb(B);
  const v = await view();
  assert.deepEqual(v.bomberIds.sort(), [A, B]);
  assert.deepEqual(v.waitlist, []);
  assert.deepEqual(v.fills ?? [], []);
});

test("a bomber who takes a seat, the waitlist or a fill leaves Bombers", async () => {
  const { sql, id, slots, view, bomb, claim } = await setup();
  for (const u of [A, B, C]) await bomb(u);
  assert.equal(await claim(slots[0]!, A), "claimed");
  await claim(slots[1]!, D);
  await joinWaitlist(sql, { contentId: id, userId: B, guildId: G, role: "Healer", now: NOW });
  const f = await joinFill(sql, { contentId: id, userId: C, guildId: G, now: NOW });
  assert.equal(f.result, "waiting");
  const v = await view();
  assert.deepEqual(v.bomberIds, []);
  assert.equal(v.waitlist!.length, 1);
});

test("the host can assign a bomber to a seat", async () => {
  const { sql, id, slots, view, bomb } = await setup();
  await bomb(A);
  assert.equal((await assignPlayer(sql, { contentId: id, guildId: G, userId: A, slotId: slots[0]!, now: NOW })).result, "ok");
  assert.deepEqual((await view()).bomberIds, []);
});

test("Leave removes a bomber (and frees the place); host removal by user works the same", async () => {
  const { sql, id, view, bomb } = await setup({ bombers: 1 });
  await bomb(A);
  assert.equal(await leaveContent(sql, { contentId: id, userId: A, guildId: G, now: NOW }), "left");
  assert.deepEqual((await view()).bomberIds, []);
  assert.equal((await bomb(B)).result, "joined");
});

test("Tentative works on a bomber and is kept when they move", async () => {
  const { sql, id, slots, view, bomb, claim } = await setup();
  await bomb(A);
  assert.deepEqual(await setTentative(sql, { contentId: id, guildId: G, userId: A }), { result: "ok", tentative: true });
  assert.deepEqual((await view()).tentative, [A]);
  await claim(slots[0]!, A);
  assert.deepEqual((await view()).tentative, [A]);
  await bomb(A);
  assert.deepEqual((await view()).tentative, [A]);
  assert.deepEqual((await view()).bomberIds, [A]);
});

test("selection mode: a host-picked seated player cannot move to Bombers; others and the host can", async () => {
  const { sql, id, slots, view, bomb } = await setup({ selection: true });
  await assignPlayer(sql, { contentId: id, guildId: G, userId: A, slotId: slots[0]!, now: NOW });
  assert.equal((await bomb(A)).result, "selected");
  assert.equal((await bomb(B)).result, "joined");
  await claimSlot(sql, { contentId: id, slotId: slots[1]!, userId: OWNER, guildId: G, now: NOW });
  assert.equal((await bomb(OWNER)).result, "joined");
  assert.deepEqual((await view()).bomberIds.sort(), [B, OWNER]);
});
