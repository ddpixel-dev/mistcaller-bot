import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { DRAFT_TTL_MS, deleteDraft, getDraft, purgeDrafts, saveDraft, startDraft } from "../../src/db/draft.ts";

const NOW = new Date("2026-10-07T12:00:00Z");
const who = { guildId: "g1", userId: "u1", threadId: "t1", loot: true, kind: "zvz" };
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

test("a started draft is empty and remembers loot and kind", async () => {
  const sql = await testSql();
  const id = await startDraft(sql, who);
  const [{ n }] = await sql`select count(*)::int as n from slot_draft`;
  assert.equal(n, 1);
  const d = (await getDraft(sql, id, new Date()))!;
  assert.deepEqual([d.count, d.slots, d.role, d.weapon, d.query, d.loot, d.kind, d.userId], [null, [], null, null, null, true, "zvz", "u1"]);
});

test("save round-trips every field", async () => {
  const sql = await testSql();
  const id = await startDraft(sql, who);
  await saveDraft(sql, id, { count: 3, slots: [{ role: "Tank", weapon: "Mace" }], role: "Healer", weapon: null, query: "holy" });
  const d = (await getDraft(sql, id, new Date()))!;
  assert.deepEqual([d.count, d.slots, d.role, d.weapon, d.query], [3, [{ role: "Tank", weapon: "Mace" }], "Healer", null, "holy"]);
});

test("starting again in the same post replaces the member's draft; others are separate", async () => {
  const sql = await testSql();
  const a = await startDraft(sql, who);
  await saveDraft(sql, a, { count: 4, slots: [], role: null, weapon: null, query: null });
  const b = await startDraft(sql, { ...who, loot: false });
  assert.equal(a, b);
  const d = (await getDraft(sql, b, new Date()))!;
  assert.deepEqual([d.count, d.loot], [null, false]);
  await startDraft(sql, { ...who, userId: "u2" });
  await startDraft(sql, { ...who, threadId: "t2" });
  assert.equal((await sql`select count(*)::int as n from slot_draft`)[0]!.n, 3);
});

test("a draft older than an hour is gone for reads and is purged by the job", async () => {
  const sql = await testSql();
  const id = await startDraft(sql, who);
  await sql`update slot_draft set created_at = ${new Date(NOW.getTime() - DRAFT_TTL_MS - 1000)} where id = ${id}`;
  assert.equal(await getDraft(sql, id, NOW), null);
  const fresh = await startDraft(sql, { ...who, userId: "u9" });
  assert.equal(await purgeDrafts(sql, NOW), 1);
  assert.ok(await getDraft(sql, fresh, new Date()));
  assert.equal(await purgeDrafts(sql, NOW), 0);
});

test("delete removes the draft", async () => {
  const sql = await testSql();
  const id = await startDraft(sql, who);
  await deleteDraft(sql, id);
  assert.equal(await getDraft(sql, id, new Date()), null);
});
