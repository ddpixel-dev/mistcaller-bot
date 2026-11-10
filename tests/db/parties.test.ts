import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import {
  createContent, getRosterView, getPartyMessages, setPartyMessageId, sortPositions, type NewContent,
} from "../../src/db/content.ts";
import { displayNumber, MAX_PARTY_SLOTS } from "../../src/domain/parties.ts";

const base: NewContent = {
  guildId: "g1", threadId: "t1", type: "pvp", title: "CTA", notes: null,
  startsAt: new Date("2026-12-01T18:00:00Z"), tier: "T8.0", hasLoot: false, createdBy: "u1", cta: true,
  slots: [{ role: "DPS", weapon: "Bow" }, { role: "Tank", weapon: "Mace" }],
  slots2: [{ role: "Support", weapon: "Occult" }, { role: "DPS", weapon: "Bow" }, { role: "Tank", weapon: "Mace" }],
};
const now = new Date("2026-11-30T00:00:00Z");

beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

test("two parties: positions continue across, each party sorted by role", async () => {
  const sql = await testSql();
  const id = await createContent(sql, base);
  const v = (await getRosterView(sql, id, now))!;
  assert.equal(v.partyCount, 2);
  assert.deepEqual(v.slots.map((s) => [s.position, s.party, s.role]),
    [[1, 1, "Tank"], [2, 1, "DPS"], [3, 2, "Tank"], [4, 2, "Support"], [5, 2, "DPS"]]);
  assert.equal(displayNumber(v.slots[2]!, v.slots), 1);
});

test("without slots2 it is one party", async () => {
  const sql = await testSql();
  const id = await createContent(sql, { ...base, slots2: undefined });
  const v = (await getRosterView(sql, id, now))!;
  assert.equal(v.partyCount, 1);
  assert.ok(v.slots.every((s) => s.party === 1));
  const id2 = await createContent(sql, { ...base, threadId: "t2", slots2: [] });
  assert.equal((await getRosterView(sql, id2, now))!.partyCount, 1);
});

test("sortPositions keeps party 1 before party 2", async () => {
  const sql = await testSql();
  const id = await createContent(sql, base);
  await sql`update slot set role = 'Tank' where content_id = ${id} and position = 2`;
  await sql`update slot set role = 'Healer' where content_id = ${id} and position = 5`;
  await sql.begin((tx) => sortPositions(tx, id));
  const v = (await getRosterView(sql, id, now))!;
  assert.deepEqual(v.slots.map((s) => [s.position, s.party, s.role]),
    [[1, 1, "Tank"], [2, 1, "Tank"], [3, 2, "Tank"], [4, 2, "Healer"], [5, 2, "Support"]]);
});

test("party messages: party 1 is content.message_id, party 2 is content_message", async () => {
  const sql = await testSql();
  const id = await createContent(sql, base);
  assert.deepEqual(await getPartyMessages(sql, id), []);
  await setPartyMessageId(sql, { guildId: "g1", contentId: id, party: 2, messageId: "m2" });
  await setPartyMessageId(sql, { guildId: "g1", contentId: id, party: 1, messageId: "m1" });
  await setPartyMessageId(sql, { guildId: "g1", contentId: id, party: 2, messageId: "m2b" });
  assert.deepEqual(await getPartyMessages(sql, id), [{ party: 1, messageId: "m1" }, { party: 2, messageId: "m2b" }]);
  const [c] = await sql`select message_id from content where id = ${id}`;
  assert.equal(c!.message_id, "m1");
  await sql`delete from content where id = ${id}`;
  const [n] = await sql`select count(*)::int as n from content_message`;
  assert.equal(n!.n, 0);
});

test("old content without a content_message row returns party 1 from content.message_id", async () => {
  const sql = await testSql();
  const id = await createContent(sql, { ...base, slots2: undefined });
  await sql`update content set message_id = 'old' where id = ${id}`;
  assert.deepEqual(await getPartyMessages(sql, id), [{ party: 1, messageId: "old" }]);
});

test("a party over the limit is refused", async () => {
  const sql = await testSql();
  const many = Array.from({ length: MAX_PARTY_SLOTS + 1 }, () => ({ role: "DPS", weapon: "Bow" }));
  await assert.rejects(createContent(sql, { ...base, slots: many }), /20/);
  await assert.rejects(createContent(sql, { ...base, slots2: many }), /20/);
});

test("partyOf maps waitlist, fill and applied users to their party", async () => {
  const sql = await testSql();
  const id = await createContent(sql, base);
  await sql`insert into signup (guild_id, content_id, user_id, status, party, wait_role) values ('g1', ${id}, 'w', 'waitlist', 2, 'Tank')`;
  await sql`insert into signup (guild_id, content_id, user_id, status, party) values ('g1', ${id}, 'f', 'fill', 2), ('g1', ${id}, 'a', 'applied', 1)`;
  const v = (await getRosterView(sql, id, now))!;
  assert.deepEqual(v.partyOf, { w: 2, f: 2, a: 1 });
  assert.equal(v.waitlist![0]!.party, 2);
});
