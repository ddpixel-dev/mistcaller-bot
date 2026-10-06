import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, deleteContent, getRosterView, setMessageId, type NewContent } from "../../src/db/content.ts";
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
