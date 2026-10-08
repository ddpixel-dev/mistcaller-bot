import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, type NewContent } from "../../src/db/content.ts";
import { claimSlot } from "../../src/db/signup.ts";
import { castVote } from "../../src/db/vote.ts";

const startsAt = new Date("2026-12-01T18:00:00Z");
const before = new Date(startsAt.getTime() - 301000);
const cutoff = new Date(startsAt.getTime() - 300000);

const base: NewContent = {
  guildId: "g1",
  threadId: "t1",
  type: "pvp",
  title: "Loot run",
  notes: null,
  startsAt,
  tier: "T8.0",
  hasLoot: true,
  createdBy: "u1",
  slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }, { role: "DPS", weapon: "Bow" }],
};

beforeEach(async () => {
  await resetDb(await testSql());
});
after(async () => {
  await (await testSql()).end();
});

async function setup(over: Partial<NewContent> = {}) {
  const sql = await testSql();
  const contentId = await createContent(sql, { ...base, ...over });
  const view = await getRosterView(sql, contentId, before);
  const slotIds = view!.slots.map((s) => s.id);
  return { sql, contentId, slotIds };
}

async function sign(sql: Awaited<ReturnType<typeof testSql>>, contentId: string, slotId: string, userId: string) {
  assert.equal(await claimSlot(sql, { contentId, slotId, userId, guildId: "g1", now: before }), "claimed");
}

async function voteCount(sql: Awaited<ReturnType<typeof testSql>>, contentId: string): Promise<number> {
  const [r] = await sql`select count(*)::int as n from vote where content_id = ${contentId}`;
  return r!.n;
}

test("signed user records a vote, other choice changes it without doubling", async () => {
  const { sql, contentId, slotIds } = await setup();
  await sign(sql, contentId, slotIds[0]!, "u1");
  const a = { contentId, userId: "u1", guildId: "g1", now: before };
  assert.equal(await castVote(sql, { ...a, choice: "split" }), "recorded");
  assert.equal(await castVote(sql, { ...a, choice: "regear" }), "changed");
  assert.equal(await voteCount(sql, contentId), 1);
  const v = await getRosterView(sql, contentId, before);
  assert.deepEqual(v!.votes, { split: 0, regear: 1 });
});

test("repeating the identical choice returns recorded and stays one row", async () => {
  const { sql, contentId, slotIds } = await setup();
  await sign(sql, contentId, slotIds[0]!, "u1");
  const a = { contentId, userId: "u1", guildId: "g1", choice: "split" as const, now: before };
  assert.equal(await castVote(sql, a), "recorded");
  assert.equal(await castVote(sql, a), "recorded");
  assert.equal(await voteCount(sql, contentId), 1);
});

test("waitlisted user gets not_signed", async () => {
  const { sql, contentId, slotIds } = await setup();
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status)
    values ('g1', ${contentId}, 'w1', ${slotIds[0]!}, 'waitlist')`;
  const r = await castVote(sql, { contentId, userId: "w1", guildId: "g1", choice: "split", now: before });
  assert.equal(r, "not_signed");
  assert.equal(await voteCount(sql, contentId), 0);
});

test("user who is not signed up gets not_signed", async () => {
  const { sql, contentId } = await setup();
  const r = await castVote(sql, { contentId, userId: "nobody", guildId: "g1", choice: "split", now: before });
  assert.equal(r, "not_signed");
});

test("content without loot returns no_loot and never shows a result", async () => {
  const { sql, contentId, slotIds } = await setup({ hasLoot: false });
  await sign(sql, contentId, slotIds[0]!, "u1");
  const r = await castVote(sql, { contentId, userId: "u1", guildId: "g1", choice: "split", now: before });
  assert.equal(r, "no_loot");
  const v = await getRosterView(sql, contentId, new Date(startsAt.getTime() + 1000));
  assert.equal(v!.voteClosed, true);
  assert.equal(v!.voteResult, null);
});

test("vote at exactly start minus 5:00 is closed and stores nothing", async () => {
  const { sql, contentId, slotIds } = await setup();
  await sign(sql, contentId, slotIds[0]!, "u1");
  const r = await castVote(sql, { contentId, userId: "u1", guildId: "g1", choice: "split", now: cutoff });
  assert.equal(r, "closed");
  assert.equal(await voteCount(sql, contentId), 0);
});

test("a closed vote cannot change an existing vote", async () => {
  const { sql, contentId, slotIds } = await setup();
  await sign(sql, contentId, slotIds[0]!, "u1");
  const a = { contentId, userId: "u1", guildId: "g1" };
  await castVote(sql, { ...a, choice: "split", now: before });
  assert.equal(await castVote(sql, { ...a, choice: "regear", now: cutoff }), "closed");
  const v = await getRosterView(sql, contentId, before);
  assert.deepEqual(v!.votes, { split: 1, regear: 0 });
});

test("cancelled content returns unavailable", async () => {
  const { sql, contentId, slotIds } = await setup();
  await sign(sql, contentId, slotIds[0]!, "u1");
  await sql`update content set status = 'cancelled' where id = ${contentId}`;
  const r = await castVote(sql, { contentId, userId: "u1", guildId: "g1", choice: "split", now: before });
  assert.equal(r, "unavailable");
  assert.equal(await voteCount(sql, contentId), 0);
});

test("done content returns unavailable", async () => {
  const { sql, contentId, slotIds } = await setup();
  await sign(sql, contentId, slotIds[0]!, "u1");
  await sql`update content set status = 'done' where id = ${contentId}`;
  const r = await castVote(sql, { contentId, userId: "u1", guildId: "g1", choice: "split", now: before });
  assert.equal(r, "unavailable");
});

test("guildId mismatch and unknown content return not_found", async () => {
  const { sql, contentId, slotIds } = await setup();
  await sign(sql, contentId, slotIds[0]!, "u1");
  assert.equal(
    await castVote(sql, { contentId, userId: "u1", guildId: "other", choice: "split", now: before }),
    "not_found",
  );
  assert.equal(
    await castVote(sql, {
      contentId: "00000000-0000-0000-0000-000000000000",
      userId: "u1",
      guildId: "g1",
      choice: "split",
      now: before,
    }),
    "not_found",
  );
  assert.equal(await voteCount(sql, contentId), 0);
});

test("voting on locked content before the cutoff is accepted", async () => {
  const { sql, contentId, slotIds } = await setup();
  await sign(sql, contentId, slotIds[0]!, "u1");
  await sql`update content set status = 'locked' where id = ${contentId}`;
  const r = await castVote(sql, { contentId, userId: "u1", guildId: "g1", choice: "regear", now: before });
  assert.equal(r, "recorded");
});

test("roster view counts votes; after the cutoff 1-1 shows a tie; before it no result", async () => {
  const { sql, contentId, slotIds } = await setup();
  await sign(sql, contentId, slotIds[0]!, "u1");
  await sign(sql, contentId, slotIds[1]!, "u2");
  await castVote(sql, { contentId, userId: "u1", guildId: "g1", choice: "split", now: before });
  await castVote(sql, { contentId, userId: "u2", guildId: "g1", choice: "regear", now: before });
  const open = await getRosterView(sql, contentId, before);
  assert.deepEqual(open!.votes, { split: 1, regear: 1 });
  assert.equal(open!.voteClosed, false);
  assert.equal(open!.voteResult, null);
  const closed = await getRosterView(sql, contentId, cutoff);
  assert.equal(closed!.voteClosed, true);
  assert.equal(closed!.voteResult, "tie");
});

test("closed view with no votes shows none", async () => {
  const { sql, contentId } = await setup();
  const v = await getRosterView(sql, contentId, cutoff);
  assert.equal(v!.voteResult, "none");
});
