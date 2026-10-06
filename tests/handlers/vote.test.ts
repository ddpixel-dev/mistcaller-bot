import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, type NewContent } from "../../src/db/content.ts";
import { claimSlot } from "../../src/db/signup.ts";
import { handleVote } from "../../src/handlers/vote.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";

const startsAt = new Date("2026-12-01T18:00:00Z");
const OPEN = new Date("2026-10-06T12:00:00Z");
const CUTOFF = new Date(startsAt.getTime() - 300000);
const base: NewContent = {
  guildId: "g1", threadId: "t1", type: "pvp", title: "Loot run", notes: null, startsAt,
  tier: { min: { tier: 8, enchant: 0 }, max: null }, hasLoot: true, createdBy: "u1",
  slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }, { role: "DPS", weapon: "Bow" }],
};
const rest: Rest = { async createMessage() { return { id: "m" }; }, async editMessage() {}, async deleteMessage() {} };

beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup(over: Partial<NewContent> = {}) {
  const sql = await testSql();
  const contentId = await createContent(sql, { ...base, ...over });
  const slots = (await getRosterView(sql, contentId, OPEN))!.slots.map((s) => s.id);
  let now = OPEN;
  const deps: Deps = { sql, rest, now: () => now };
  const sign = async (userId: string, n: number) =>
    assert.equal(await claimSlot(sql, { contentId, slotId: slots[n]!, userId, guildId: "g1", now: OPEN }), "claimed");
  return { sql, deps, contentId, slots, sign, setNow: (d: Date) => { now = d; } };
}

const click = (customId: string, over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1",
  member: { user: { id: "u1" }, roles: [] },
  data: { custom_id: customId, component_type: 2 },
  ...over,
});
const votes = async (sql: any, id: string) => (await sql`select count(*)::int as n from vote where content_id = ${id}`)[0].n;
const isEphemeral = (r: any, text?: string) => {
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  if (text) assert.ok(r.data.content.includes(text), r.data.content);
};
const labels = (r: any) => r.data.components[2].components.map((b: any) => b.label);

test("signed user votes Split: type 7 with updated count", async () => {
  const { deps, contentId, sign } = await setup();
  await sign("u1", 0);
  const r: any = await handleVote(deps, click(`vote:${contentId}:split`));
  assert.equal(r.type, 7);
  assert.deepEqual(labels(r), ["Split (1)", "Regear (0)"]);
  assert.ok(r.data.embeds[0].description.includes("Loot vote: Split 1 - Regear 0"));
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
});

test("changed vote updates the count without doubling", async () => {
  const { sql, deps, contentId, sign } = await setup();
  await sign("u1", 0);
  await handleVote(deps, click(`vote:${contentId}:split`));
  const r: any = await handleVote(deps, click(`vote:${contentId}:regear`));
  assert.equal(r.type, 7);
  assert.deepEqual(labels(r), ["Split (0)", "Regear (1)"]);
  assert.equal(await votes(sql, contentId), 1);
});

test("dispatch routes vote: to the handler", async () => {
  const { deps, contentId, sign } = await setup();
  await sign("u1", 0);
  const r: any = await createDispatch(deps)(click(`vote:${contentId}:split`));
  assert.equal(r.type, 7);
});

test("click after the cutoff is closed, no change", async () => {
  const { sql, deps, contentId, sign, setNow } = await setup();
  await sign("u1", 0);
  setNow(new Date(CUTOFF.getTime() + 1000));
  isEphemeral(await handleVote(deps, click(`vote:${contentId}:split`)), "closed");
  assert.equal(await votes(sql, contentId), 0);
});

test("click exactly at start minus 5:00 is closed", async () => {
  const { sql, deps, contentId, sign, setNow } = await setup();
  await sign("u1", 0);
  setNow(CUTOFF);
  isEphemeral(await handleVote(deps, click(`vote:${contentId}:split`)), "closed");
  assert.equal(await votes(sql, contentId), 0);
});

test("one millisecond before the cutoff is accepted", async () => {
  const { deps, contentId, sign, setNow } = await setup();
  await sign("u1", 0);
  setNow(new Date(CUTOFF.getTime() - 1));
  assert.equal(((await handleVote(deps, click(`vote:${contentId}:split`))) as any).type, 7);
});

test("response after the cutoff shows the result line and disabled buttons", async () => {
  const { deps, contentId, sign, setNow } = await setup();
  await sign("u1", 0);
  await handleVote(deps, click(`vote:${contentId}:split`));
  setNow(CUTOFF);
  const r: any = await handleVote(deps, click(`vote:${contentId}:regear`));
  isEphemeral(r, "closed");
  // a valid later success path is not possible after cutoff, so check the refreshed view via render
  const { getRosterView: g } = await import("../../src/db/content.ts");
  const { renderRosterMessage } = await import("../../src/render/roster.ts");
  const m: any = renderRosterMessage((await g(deps.sql, contentId, CUTOFF))!);
  assert.ok(m.embeds[0].description.includes("Loot vote result: Split won 1-0"));
  assert.ok(m.components[2].components.every((b: any) => b.disabled === true));
});

test("not signed up and waitlisted users are refused, no change", async () => {
  const { sql, deps, contentId, slots } = await setup();
  isEphemeral(await handleVote(deps, click(`vote:${contentId}:split`)), "signed up");
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status) values ('g1', ${contentId}, 'w1', ${slots[0]!}, 'waitlist')`;
  isEphemeral(
    await handleVote(deps, click(`vote:${contentId}:split`, { member: { user: { id: "w1" }, roles: [] } })),
    "signed up",
  );
  assert.equal(await votes(sql, contentId), 0);
});

test("no-loot content refuses the vote", async () => {
  const { sql, deps, contentId, sign } = await setup({ hasLoot: false });
  await sign("u1", 0);
  isEphemeral(await handleVote(deps, click(`vote:${contentId}:split`)));
  assert.equal(await votes(sql, contentId), 0);
});

test("cancelled content refuses the vote", async () => {
  const { sql, deps, contentId, sign } = await setup();
  await sign("u1", 0);
  await sql`update content set status = 'cancelled' where id = ${contentId}`;
  isEphemeral(await handleVote(deps, click(`vote:${contentId}:split`)));
  assert.equal(await votes(sql, contentId), 0);
});

test("guild mismatch leaves the vote table empty", async () => {
  const { sql, deps, contentId, sign } = await setup();
  await sign("u1", 0);
  isEphemeral(await handleVote(deps, click(`vote:${contentId}:split`, { guild_id: "g2" })));
  assert.equal(await votes(sql, contentId), 0);
});

test("forged choice, malformed ids, unknown content and DM are refused", async () => {
  const { sql, deps, contentId, sign } = await setup();
  await sign("u1", 0);
  const ids = [
    `vote:${contentId}:other`, `vote:${contentId}:`, `vote:${contentId}`, `vote:${contentId}:split:x`,
    "vote:not-a-uuid:split", "vote::split", "vote", `leave:${contentId}:split`,
    `vote:${contentId}'; drop table content;--:split`,
    "vote:00000000-0000-4000-8000-000000000000:split",
  ];
  for (const id of ids) isEphemeral(await handleVote(deps, click(id)));
  isEphemeral(await handleVote(deps, click(`vote:${contentId}:split`, { member: undefined })));
  isEphemeral(await handleVote(deps, click(`vote:${contentId}:split`, { guild_id: undefined })));
  isEphemeral(await handleVote(deps, click(undefined as any)));
  assert.equal(await votes(sql, contentId), 0);
});
