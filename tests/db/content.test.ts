import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import {
  PostTakenError, createContent, deleteContent, findContentInThread, getRosterView, setMessageId,
  type NewContent,
} from "../../src/db/content.ts";
import { getGuildSettings } from "../../src/db/settings.ts";

const startsAt = new Date("2026-12-01T18:00:00Z");
const base: NewContent = {
  guildId: "g1",
  threadId: "t1",
  type: "pvp",
  title: "Ganking",
  notes: null,
  startsAt,
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

test("createContent stores slots in input order and getRosterView reads them", async () => {
  const sql = await testSql();
  const id = await createContent(sql, base);
  const v = await getRosterView(sql, id, new Date());
  assert.ok(v);
  assert.equal(v.id, id);
  assert.equal(v.status, "open");
  assert.equal(v.guildId, "g1");
  assert.equal(v.threadId, "t1");
  assert.equal(v.messageId, null);
  assert.equal(v.type, "pvp");
  assert.equal(v.title, "Ganking");
  assert.equal(v.notes, null);
  assert.equal(v.startsAt.getTime(), startsAt.getTime());
  assert.ok(v.startsAt instanceof Date);
  assert.deepEqual(v.tier, { min: { tier: 8, enchant: 0 }, max: null });
  assert.deepEqual(v.slots.map((s) => [s.position, s.role, s.weapon, s.userId]), [
    [1, "Tank", "Mace", null],
    [2, "Healer", "Holy", null],
    [3, "DPS", "Bow", null],
  ]);
  assert.deepEqual(v.votes, { split: 0, regear: 0 });
  assert.equal(v.voteClosed, false);
  assert.equal(v.voteResult, null);
});

test("tier range with max maps back", async () => {
  const sql = await testSql();
  const id = await createContent(sql, {
    ...base,
    notes: "bring food",
    hasLoot: true,
    tier: { min: { tier: 6, enchant: 1 }, max: { tier: 8, enchant: 3 } },
  });
  const v = await getRosterView(sql, id, new Date());
  assert.deepEqual(v?.tier, { min: { tier: 6, enchant: 1 }, max: { tier: 8, enchant: 3 } });
  assert.equal(v?.notes, "bring food");
  assert.equal(v?.hasLoot, true);
});

test("unknown id returns null", async () => {
  const sql = await testSql();
  assert.equal(await getRosterView(sql, "00000000-0000-0000-0000-000000000000", new Date()), null);
});

test("setMessageId is reflected in the view", async () => {
  const sql = await testSql();
  const id = await createContent(sql, base);
  await setMessageId(sql, id, "m9");
  assert.equal((await getRosterView(sql, id, new Date()))?.messageId, "m9");
});

test("signed signup shows as userId, waitlist does not", async () => {
  const sql = await testSql();
  const id = await createContent(sql, base);
  const slots = await sql`select id from slot where content_id = ${id} order by position`;
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status) values ('g1', ${id}, 'alice', ${slots[0]!.id}, 'signed')`;
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status) values ('g1', ${id}, 'bob', ${slots[1]!.id}, 'waitlist')`;
  const v = await getRosterView(sql, id, new Date());
  assert.deepEqual(v?.slots.map((s) => s.userId), ["alice", null, null]);
});

test("createContent is atomic: bad slot rolls back the content", async () => {
  const sql = await testSql();
  await assert.rejects(createContent(sql, { ...base, type: "bogus" as never }));
  const [{ n }] = await sql`select count(*)::int as n from content`;
  assert.equal(n, 0);
});

test("deleteContent removes content and slots", async () => {
  const sql = await testSql();
  const id = await createContent(sql, base);
  await deleteContent(sql, id);
  assert.equal(await getRosterView(sql, id, new Date()), null);
  const [{ n }] = await sql`select count(*)::int as n from slot`;
  assert.equal(n, 0);
});

test("getGuildSettings returns null for unknown guild and the row after insert", async () => {
  const sql = await testSql();
  assert.equal(await getGuildSettings(sql, "g1"), null);
  await sql`insert into guild_settings (guild_id, officer_role_id, pvp_forum_id, pve_forum_id) values ('g1', 'r1', 'f1', 'f2')`;
  assert.deepEqual(await getGuildSettings(sql, "g1"), {
    guildId: "g1",
    officerRoleId: "r1",
    pvpForumId: "f1",
    pveForumId: "f2",
    dailyCap: 5,
  });
});

test("createContent with 20 slots stores all in input order", async () => {
  const sql = await testSql();
  const slots = Array.from({ length: 20 }, (_, i) => ({ role: `Role${i + 1}`, weapon: `Weapon${i + 1}` }));
  const id = await createContent(sql, { ...base, slots });
  const rows = await sql`select position, role, weapon, guild_id from slot where content_id = ${id} order by position`;
  assert.equal(rows.length, 20);
  rows.forEach((r, i) => {
    assert.equal(r.position, i + 1);
    assert.equal(r.role, `Role${i + 1}`);
    assert.equal(r.weapon, `Weapon${i + 1}`);
    assert.equal(r.guild_id, "g1");
  });
});

test("getRosterView sets started when starts_at <= now", async () => {
  const sql = await testSql();
  const id = await createContent(sql, base);
  assert.equal((await getRosterView(sql, id, new Date(startsAt.getTime() - 1)))!.started, false);
  assert.equal((await getRosterView(sql, id, startsAt))!.started, true);
  assert.equal((await getRosterView(sql, id, new Date(startsAt.getTime() + 1)))!.started, true);
});

test("a second content in the same post is rejected with PostTakenError", async () => {
  const sql = await testSql();
  await createContent(sql, base);
  await assert.rejects(createContent(sql, { ...base, title: "Again" }), PostTakenError);
  const [{ n }] = await sql`select count(*)::int as n from content`;
  assert.equal(n, 1);
  const [{ s }] = await sql`select count(*)::int as s from slot`;
  assert.equal(s, 3);
});

test("the same thread id in another guild is allowed", async () => {
  const sql = await testSql();
  await createContent(sql, base);
  await createContent(sql, { ...base, guildId: "g2" });
});

test("a cancelled content frees the post; locked and done do not", async () => {
  const sql = await testSql();
  const id = await createContent(sql, base);
  for (const status of ["locked", "done"]) {
    await sql`update content set status = ${status} where id = ${id}`;
    await assert.rejects(createContent(sql, base), PostTakenError);
  }
  await sql`update content set status = 'cancelled' where id = ${id}`;
  await createContent(sql, { ...base, title: "Second" });
});

test("two simultaneous creates in one post leave exactly one winner", async () => {
  const sql = await testSql();
  const results = await Promise.allSettled([createContent(sql, base), createContent(sql, base)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.ok(lost.reason instanceof PostTakenError);
});

test("findContentInThread returns the blocking content, ignoring cancelled", async () => {
  const sql = await testSql();
  assert.equal(await findContentInThread(sql, "g1", "t1"), null);
  const id = await createContent(sql, base);
  await setMessageId(sql, id, "m1");
  assert.deepEqual(await findContentInThread(sql, "g1", "t1"), { id, status: "open", messageId: "m1" });
  assert.equal(await findContentInThread(sql, "g2", "t1"), null);
  await sql`update content set status = 'cancelled' where id = ${id}`;
  assert.equal(await findContentInThread(sql, "g1", "t1"), null);
});
