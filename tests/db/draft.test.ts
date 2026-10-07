import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { DRAFT_TTL_MS, deleteDraft, findDraft, getDraft, purgeDrafts, saveDraft, startDraft } from "../../src/db/draft.ts";

const NOW = new Date("2026-10-07T12:00:00Z");
const who = { guildId: "g1", userId: "u1", threadId: "t1", type: "pvp" as const, loot: true, kind: "zvz" };
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

test("a started draft is empty and remembers loot and kind", async () => {
  const sql = await testSql();
  const id = await startDraft(sql, who);
  const d = (await getDraft(sql, id, new Date()))!;
  assert.deepEqual([d.counts, d.slots, d.query, d.loot, d.kind, d.userId, d.type], [null, [], null, true, "zvz", "u1", "pvp"]);
});

test("save round-trips the role numbers, slots and search text", async () => {
  const sql = await testSql();
  const id = await startDraft(sql, who);
  await saveDraft(sql, id, { counts: [1, 2, 0, 3], slots: [{ role: "Tank", weapon: "Mace" }], query: "holy" });
  const d = (await getDraft(sql, id, new Date()))!;
  assert.deepEqual([d.counts, d.slots, d.query], [[1, 2, 0, 3], [{ role: "Tank", weapon: "Mace" }], "holy"]);
  await saveDraft(sql, id, { counts: null, slots: [], query: null });
  assert.equal((await getDraft(sql, id, new Date()))!.counts, null);
});

test("starting again in the same post replaces the member's draft; others are separate", async () => {
  const sql = await testSql();
  const a = await startDraft(sql, who);
  await saveDraft(sql, a, { counts: [1, 1, 1, 1], slots: [{ role: "Tank", weapon: "X" }], query: "q" });
  const b = await startDraft(sql, { ...who, loot: false });
  assert.equal(a, b);
  const d = (await getDraft(sql, b, new Date()))!;
  assert.deepEqual([d.counts, d.slots, d.query, d.loot], [null, [], null, false]);
  await startDraft(sql, { ...who, userId: "u2" });
  await startDraft(sql, { ...who, threadId: "t2" });
  assert.equal((await sql`select count(*)::int as n from slot_draft`)[0]!.n, 3);
});

test("findDraft returns this member's draft in this post, not others, and not expired ones", async () => {
  const sql = await testSql();
  const id = await startDraft(sql, who);
  assert.equal((await findDraft(sql, who, new Date()))!.id, id);
  assert.equal(await findDraft(sql, { ...who, userId: "u2" }, new Date()), null);
  assert.equal(await findDraft(sql, { ...who, threadId: "t9" }, new Date()), null);
  assert.equal(await findDraft(sql, who, new Date(Date.now() + DRAFT_TTL_MS + 5000)), null);
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
