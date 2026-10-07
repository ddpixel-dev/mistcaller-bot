import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, type NewContent } from "../../src/db/content.ts";
import { cancelContent, editContent, getManageTarget, getManageTargetById, type EditInput } from "../../src/db/manage.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const starts = new Date("2026-12-01T18:00:00Z");
const base: NewContent = {
  guildId: "g1", threadId: "t1", type: "pvp", title: "Ganking", notes: null, startsAt: starts,
  tier: { min: { tier: 8, enchant: 0 }, max: null }, hasLoot: false, createdBy: "u1",
  slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }, { role: "DPS", weapon: "Bow" }],
};
const edit = (over: Partial<EditInput> = {}): EditInput => ({
  title: base.title, notes: base.notes, startsAt: starts, tier: base.tier, hasLoot: null, slots: base.slots, ...over,
});

beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup() {
  const sql = await testSql();
  const id = await createContent(sql, base);
  const v = (await getRosterView(sql, id, NOW))!;
  return { sql, id, slotIds: v.slots.map((s) => s.id) };
}
const sign = (sql: any, id: string, user: string, slot: string, status = "signed") =>
  sql`insert into signup (guild_id, content_id, user_id, slot_id, status) values ('g1', ${id}, ${user}, ${slot}, ${status})`;

test("getManageTarget finds the active content by thread and ignores cancelled", async () => {
  const { sql, id } = await setup();
  const t = await getManageTarget(sql, "g1", "t1");
  assert.equal(t?.id, id);
  assert.equal(t?.createdBy, "u1");
  assert.equal((await getManageTargetById(sql, id))?.status, "open");
  await sql`update content set status = 'cancelled'`;
  assert.equal(await getManageTarget(sql, "g1", "t1"), null);
  assert.equal(await getManageTargetById(sql, "00000000-0000-0000-0000-000000000000"), null);
});

test("edit changes the fields and keeps the loot flag when null", async () => {
  const { sql, id } = await setup();
  const r = await editContent(sql, id, edit({
    title: "New", notes: "bring food", tier: { min: { tier: 6, enchant: 1 }, max: { tier: 8, enchant: 0 } },
  }), NOW);
  assert.deepEqual(r, { result: "ok", startChanged: false, notify: [] });
  const v = (await getRosterView(sql, id, NOW))!;
  assert.equal(v.title, "New");
  assert.equal(v.notes, "bring food");
  assert.deepEqual(v.tier, { min: { tier: 6, enchant: 1 }, max: { tier: 8, enchant: 0 } });
  assert.equal(v.hasLoot, false);
  await editContent(sql, id, edit({ hasLoot: true }), NOW);
  assert.equal((await getRosterView(sql, id, NOW))!.hasLoot, true);
  await editContent(sql, id, edit({ hasLoot: null }), NOW);
  assert.equal((await getRosterView(sql, id, NOW))!.hasLoot, true);
});

test("changing the start reports the signed members, in join order, not the waitlist", async () => {
  const { sql, id, slotIds } = await setup();
  await sign(sql, id, "a", slotIds[0]!);
  await sign(sql, id, "b", slotIds[1]!);
  await sign(sql, id, "w", slotIds[0]!, "waitlist");
  const later = new Date("2026-12-02T18:00:00Z");
  const r = await editContent(sql, id, edit({ startsAt: later }), NOW);
  assert.deepEqual(r, { result: "ok", startChanged: true, notify: ["a", "b"] });
  assert.equal((await getRosterView(sql, id, NOW))!.startsAt.getTime(), later.getTime());
});

test("rename keeps the holder; add appends; empty trailing slot is removed", async () => {
  const { sql, id, slotIds } = await setup();
  await sign(sql, id, "a", slotIds[0]!);
  await editContent(sql, id, edit({
    slots: [{ role: "Off-Tank", weapon: "Mace" }, base.slots[1]!, base.slots[2]!, { role: "Scout", weapon: "Bow" }],
  }), NOW);
  let v = (await getRosterView(sql, id, NOW))!;
  assert.deepEqual(v.slots.map((s) => [s.position, s.role, s.userId]), [
    [1, "Off-Tank", "a"], [2, "Healer", null], [3, "DPS", null], [4, "Scout", null],
  ]);
  await editContent(sql, id, edit({ slots: [{ role: "Off-Tank", weapon: "Mace" }, base.slots[1]!] }), NOW);
  v = (await getRosterView(sql, id, NOW))!;
  assert.deepEqual(v.slots.map((s) => s.position), [1, 2]);
});

test("removing a held slot is refused and nothing changes", async () => {
  const { sql, id, slotIds } = await setup();
  await sign(sql, id, "c", slotIds[2]!);
  const r = await editContent(sql, id, edit({ title: "Changed", slots: base.slots.slice(0, 2) }), NOW);
  assert.equal(r.result, "slots_held");
  const v = (await getRosterView(sql, id, NOW))!;
  assert.equal(v.title, "Ganking");
  assert.equal(v.slots.length, 3);
});

test("edit is refused once locked, started, cancelled or done", async () => {
  const { sql, id } = await setup();
  for (const status of ["locked", "cancelled", "done"]) {
    await sql`update content set status = ${status} where id = ${id}`;
    assert.deepEqual(await editContent(sql, id, edit(), NOW), { result: "unavailable" });
  }
  await sql`update content set status = 'open' where id = ${id}`;
  assert.deepEqual(await editContent(sql, id, edit(), new Date("2026-12-01T19:00:00Z")), { result: "unavailable" });
});

test("cancel marks the content cancelled and returns the signed members once", async () => {
  const { sql, id, slotIds } = await setup();
  await sign(sql, id, "a", slotIds[0]!);
  await sign(sql, id, "w", slotIds[0]!, "waitlist");
  assert.deepEqual(await cancelContent(sql, id), { result: "ok", notify: ["a"] });
  assert.equal((await getRosterView(sql, id, NOW))!.status, "cancelled");
  assert.deepEqual(await cancelContent(sql, id), { result: "unavailable" });
});

test("cancel works on locked content and refuses done", async () => {
  const { sql, id } = await setup();
  await sql`update content set status = 'locked'`;
  assert.equal((await cancelContent(sql, id)).result, "ok");
  await sql`update content set status = 'done'`;
  assert.deepEqual(await cancelContent(sql, id), { result: "unavailable" });
});
