import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, type NewContent } from "../../src/db/content.ts";
import { editContent } from "../../src/db/manage.ts";
import { claimSlot, joinWaitlist, leaveContent, type Promotion } from "../../src/db/signup.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const base: NewContent = {
  guildId: "g1", threadId: "t1", type: "pvp", title: "Raid", notes: null, startsAt: new Date("2026-12-01T18:00:00Z"),
  tier: "T8.0", hasLoot: false, createdBy: "boss", now: NOW,
  slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }, { role: "Healer", weapon: "Fallen" }, { role: "DPS", weapon: "Bow" }],
};
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup() {
  const sql = await testSql();
  const id = await createContent(sql, base);
  const slots = (await getRosterView(sql, id, NOW))!.slots.map((s) => s.id);
  const claim = (user: string, slot: string, promoted?: Promotion[]) =>
    claimSlot(sql, { contentId: id, slotId: slot, userId: user, guildId: "g1", now: NOW, ...(promoted ? { promoted } : {}) });
  const wait = (user: string, role: string, now = NOW) => joinWaitlist(sql, { contentId: id, userId: user, guildId: "g1", role, now });
  const leave = (user: string, promoted?: Promotion[]) =>
    leaveContent(sql, { contentId: id, userId: user, guildId: "g1", now: NOW, ...(promoted ? { promoted } : {}) });
  const view = async () => (await getRosterView(sql, id, NOW))!;
  return { sql, id, slots, claim, wait, leave, view };
}

test("a role with open positions cannot be waited for; once all are taken the member joins the waitlist", async () => {
  const { slots, claim, wait, view } = await setup();
  assert.equal(await wait("w1", "Healer"), "open_slot");
  await claim("h1", slots[1]!);
  assert.equal(await wait("w1", "Healer"), "open_slot");
  await claim("h2", slots[2]!);
  assert.equal(await wait("w1", "healer"), "ok");
  assert.deepEqual((await view()).waitlist, [{ userId: "w1", role: "Healer" }]);
  assert.equal(await wait("w1", "Healer"), "already");
  assert.equal(await wait("w2", "Mage"), "unknown_role");
});

test("the waitlist keeps join order; switching role puts you at the back; a seated member cannot wait", async () => {
  const { slots, claim, wait, view } = await setup();
  await claim("t1", slots[0]!);
  await claim("h1", slots[1]!);
  await claim("h2", slots[2]!);
  await claim("d1", slots[3]!);
  for (const [u, r] of [["a", "Healer"], ["b", "Tank"], ["c", "Healer"]] as const) assert.equal(await wait(u, r), "ok");
  assert.deepEqual((await view()).waitlist!.map((w) => w.userId), ["a", "b", "c"]);
  assert.equal(await wait("a", "Tank"), "ok");
  assert.deepEqual((await view()).waitlist!.map((w) => [w.userId, w.role]), [["b", "Tank"], ["c", "Healer"], ["a", "Tank"]]);
  assert.equal(await wait("h1", "Tank"), "signed");
});

test("a leaving member's position goes to the first waiter of THAT role, inside the same change", async () => {
  const { sql, slots, claim, wait, leave, view } = await setup();
  await claim("t1", slots[0]!);
  await claim("h1", slots[1]!);
  await claim("h2", slots[2]!);
  await claim("d1", slots[3]!);
  await wait("tankWaiter", "Tank");
  await wait("healWaiter1", "Healer");
  await wait("healWaiter2", "Healer");
  const promoted: Promotion[] = [];
  assert.equal(await leave("h2", promoted), "left");
  assert.deepEqual(promoted.map((p) => [p.userId, p.position, p.role, p.weapon]), [["healWaiter1", 3, "Healer", "Fallen"]]);
  const v = await view();
  assert.equal(v.slots[2]!.userId, "healWaiter1");
  assert.deepEqual(v.waitlist!.map((w) => w.userId), ["tankWaiter", "healWaiter2"]);
  const [row] = await sql`select status, slot_id, wait_role from signup where user_id = 'healWaiter1'`;
  assert.deepEqual([row!.status, row!.wait_role], ["signed", null]);
  const none: Promotion[] = [];
  assert.equal(await leave("healWaiter2", none), "left");
  assert.deepEqual(none, []);
  assert.deepEqual((await view()).waitlist!.map((w) => w.userId), ["tankWaiter"]);
});

test("a member waiting for one role who takes an open position of another role leaves the waitlist", async () => {
  const { slots, claim, wait, view } = await setup();
  await claim("t1", slots[0]!);
  await wait("w", "Tank");
  assert.equal(await claim("w", slots[3]!), "claimed");
  assert.deepEqual((await view()).waitlist, []);
});

test("promotion also happens when someone moves away: their old position goes to the waiter", async () => {
  const { slots, claim, wait, view } = await setup();
  await claim("t1", slots[0]!);
  await claim("d1", slots[3]!);
  await wait("tw", "Tank");
  // d1 cannot take the Tank position (taken); free the Healer slots to give d1 somewhere to move
  const moved: Promotion[] = [];
  assert.equal(await claim("d1", slots[1]!, moved), "moved");
  assert.deepEqual(moved, []);
  await claim("x", slots[2]!);
  const wd = await wait("dw", "DPS");
  assert.equal(wd, "open_slot");
  const promoted: Promotion[] = [];
  // t1 moves from Tank to the open DPS position; the Tank waiter takes the Tank position
  assert.equal(await claim("t1", slots[3]!, promoted), "moved");
  assert.deepEqual(promoted.map((p) => [p.userId, p.role]), [["tw", "Tank"]]);
  assert.equal((await view()).slots[0]!.userId, "tw");
});

test("no promotion once the content is locked, started, or cancelled", async () => {
  const { sql, id, slots, claim, wait, leave, view } = await setup();
  await claim("t1", slots[0]!);
  await wait("tw", "Tank");
  await sql`update content set status = 'locked' where id = ${id}`;
  const promoted: Promotion[] = [];
  assert.equal(await leave("t1", promoted), "left");
  assert.deepEqual(promoted, []);
  assert.equal((await view()).slots[0]!.userId, null);
  assert.deepEqual((await view()).waitlist!.map((w) => w.userId), ["tw"]);
  assert.equal(await wait("late", "Tank"), "locked");
});

test("the waitlist is refused for content that does not exist in this guild", async () => {
  const { sql, id } = await setup();
  assert.equal(await joinWaitlist(sql, { contentId: id, userId: "u", guildId: "g2", role: "Tank", now: NOW }), "not_found");
});

test("adding a position of a waited role in an edit seats the first waiter and reports it", async () => {
  const { sql, id, slots, claim, wait, view } = await setup();
  await claim("t1", slots[0]!);
  await wait("tw", "Tank");
  const r = await editContent(sql, id, {
    title: "Raid", notes: null, startsAt: base.startsAt, tier: base.tier, hasLoot: null, kind: null,
    slots: [...base.slots, { role: "Tank", weapon: "Hammer" }],
  }, NOW);
  assert.equal(r.result, "ok");
  assert.deepEqual((r as any).promoted.map((p: Promotion) => [p.userId, p.position, p.weapon]), [["tw", 5, "Hammer"]]);
  assert.equal((await view()).slots[4]!.userId, "tw");
  assert.deepEqual((await view()).waitlist, []);
});

test("two simultaneous leaves seat two different waiters and never the same one twice", async () => {
  const { sql, slots, claim, wait, leave, view } = await setup();
  await claim("h1", slots[1]!);
  await claim("h2", slots[2]!);
  await wait("w1", "Healer");
  await wait("w2", "Healer");
  const a: Promotion[] = [], b: Promotion[] = [];
  await Promise.all([leave("h1", a), leave("h2", b)]);
  const seated = [...a, ...b].map((p) => p.userId).sort();
  assert.deepEqual(seated, ["w1", "w2"]);
  const rows = await sql`select user_id, status from signup order by user_id`;
  assert.deepEqual(rows.map((r) => [r.user_id, r.status]), [["w1", "signed"], ["w2", "signed"]]);
  assert.deepEqual((await view()).waitlist, []);
});
