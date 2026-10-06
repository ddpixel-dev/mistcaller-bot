import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, type NewContent } from "../../src/db/content.ts";
import { claimSlot, leaveContent } from "../../src/db/signup.ts";

const base: NewContent = {
  guildId: "g1",
  threadId: "t1",
  type: "pvp",
  title: "Ganking",
  notes: null,
  startsAt: new Date("2026-12-01T18:00:00Z"),
  tier: { min: { tier: 8, enchant: 0 }, max: null },
  hasLoot: false,
  createdBy: "u1",
  slots: [
    { role: "Tank", weapon: "Mace" },
    { role: "Healer", weapon: "Holy" },
    { role: "DPS", weapon: "Bow" },
  ],
};

beforeEach(async () => {
  await resetDb(await testSql());
});
after(async () => {
  await (await testSql()).end();
});

async function setup(slots = base.slots) {
  const sql = await testSql();
  const contentId = await createContent(sql, { ...base, slots });
  const view = await getRosterView(sql, contentId, new Date());
  return { sql, contentId, slotIds: view!.slots.map((s) => s.id) };
}

async function holders(sql: Awaited<ReturnType<typeof testSql>>, contentId: string) {
  const v = await getRosterView(sql, contentId, new Date());
  return v!.slots.map((s) => s.userId);
}

test("claiming an open slot returns claimed and the roster shows the user", async () => {
  const { sql, contentId, slotIds } = await setup();
  const r = await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1" });
  assert.equal(r, "claimed");
  assert.deepEqual(await holders(sql, contentId), ["u1", null, null]);
});

test("claiming a different slot returns moved and frees the old slot", async () => {
  const { sql, contentId, slotIds } = await setup();
  await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1" });
  const r = await claimSlot(sql, { contentId, slotId: slotIds[1]!, userId: "u1", guildId: "g1" });
  assert.equal(r, "moved");
  assert.deepEqual(await holders(sql, contentId), [null, "u1", null]);
});

test("claiming the same slot again returns unchanged", async () => {
  const { sql, contentId, slotIds } = await setup();
  const a = { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1" };
  await claimSlot(sql, a);
  assert.equal(await claimSlot(sql, a), "unchanged");
  assert.deepEqual(await holders(sql, contentId), ["u1", null, null]);
  const rows = await sql`select 1 from signup where content_id = ${contentId}`;
  assert.equal(rows.length, 1);
});

test("another user claiming a taken slot returns taken and the holder is unchanged", async () => {
  const { sql, contentId, slotIds } = await setup();
  await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1" });
  const r = await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u2", guildId: "g1" });
  assert.equal(r, "taken");
  assert.deepEqual(await holders(sql, contentId), ["u1", null, null]);
  const rows = await sql`select 1 from signup where content_id = ${contentId} and user_id = 'u2'`;
  assert.equal(rows.length, 0);
});

test("moving onto a taken slot returns taken and keeps the old slot", async () => {
  const { sql, contentId, slotIds } = await setup();
  await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1" });
  await claimSlot(sql, { contentId, slotId: slotIds[1]!, userId: "u2", guildId: "g1" });
  const r = await claimSlot(sql, { contentId, slotId: slotIds[1]!, userId: "u1", guildId: "g1" });
  assert.equal(r, "taken");
  assert.deepEqual(await holders(sql, contentId), ["u1", "u2", null]);
});

test("a slot of another content or a different guild returns not_found", async () => {
  const { sql, contentId, slotIds } = await setup();
  const other = await createContent(sql, base);
  const otherSlots = (await getRosterView(sql, other, new Date()))!.slots;
  assert.equal(
    await claimSlot(sql, { contentId, slotId: otherSlots[0]!.id, userId: "u1", guildId: "g1" }),
    "not_found",
  );
  assert.equal(
    await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g2" }),
    "not_found",
  );
  assert.equal(
    await claimSlot(sql, {
      contentId: "00000000-0000-0000-0000-000000000000",
      slotId: slotIds[0]!,
      userId: "u1",
      guildId: "g1",
    }),
    "not_found",
  );
  assert.deepEqual(await holders(sql, contentId), [null, null, null]);
});

test("locked, cancelled and done content return locked for a claim", async () => {
  const { sql, contentId, slotIds } = await setup();
  for (const status of ["locked", "cancelled", "done"]) {
    await sql`update content set status = ${status} where id = ${contentId}`;
    const r = await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1" });
    assert.equal(r, "locked", status);
  }
  assert.deepEqual(await holders(sql, contentId), [null, null, null]);
});

test("race: two different users on one slot yield exactly one claimed and one taken", async () => {
  const sql = await testSql();
  for (let i = 0; i < 25; i++) {
    const contentId = await createContent(sql, { ...base, slots: [{ role: "Tank", weapon: "Mace" }] });
    const slotId = (await getRosterView(sql, contentId, new Date()))!.slots[0]!.id;
    const results = await Promise.all([
      claimSlot(sql, { contentId, slotId, userId: "ua", guildId: "g1" }),
      claimSlot(sql, { contentId, slotId, userId: "ub", guildId: "g1" }),
    ]);
    assert.deepEqual([...results].sort(), ["claimed", "taken"], `trial ${i}`);
  }
});

test("leaveContent frees the slot, then returns not_signed", async () => {
  const { sql, contentId, slotIds } = await setup();
  await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1" });
  assert.equal(await leaveContent(sql, { contentId, userId: "u1" }), "left");
  assert.deepEqual(await holders(sql, contentId), [null, null, null]);
  assert.equal(await leaveContent(sql, { contentId, userId: "u1" }), "not_signed");
  assert.equal(await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u2", guildId: "g1" }), "claimed");
});

test("leaveContent works on locked content and is unavailable on cancelled or done", async () => {
  const { sql, contentId, slotIds } = await setup();
  await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1" });
  await sql`update content set status = 'locked' where id = ${contentId}`;
  assert.equal(await leaveContent(sql, { contentId, userId: "u1" }), "left");

  await sql`update content set status = 'open' where id = ${contentId}`;
  await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1" });
  for (const status of ["cancelled", "done"]) {
    await sql`update content set status = ${status} where id = ${contentId}`;
    assert.equal(await leaveContent(sql, { contentId, userId: "u1" }), "unavailable", status);
  }
  assert.deepEqual(await holders(sql, contentId), ["u1", null, null]);
  assert.equal(
    await leaveContent(sql, { contentId: "00000000-0000-0000-0000-000000000000", userId: "u1" }),
    "unavailable",
  );
});
