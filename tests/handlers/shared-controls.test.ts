import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setMessageId } from "../../src/db/content.ts";
import { claimSlot } from "../../src/db/signup.ts";
import { listSchedule } from "../../src/db/schedule.ts";
import { handlePing } from "../../src/handlers/ping.ts";
import { handleCancelButton, handleLock, handleUnlock, handleListCommand } from "../../src/handlers/manage.ts";
import { handleEnd, handleReopen } from "../../src/handlers/attendance.ts";
import { endStale, postVoteResults, sendReminders, AUTO_END_MS } from "../../src/jobs/cron.ts";
import { renderRosterMessage } from "../../src/render/roster.ts";
import type { Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { flatComponents } from "../helpers/discordLimits.ts";

const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 40 * 60000);
const OWNER = "boss";
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup(over: { hasLoot?: boolean } = {}) {
  const sql = await testSql();
  const id = await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvp", title: "CTA", notes: null, startsAt: START, tier: "T8.0",
    hasLoot: over.hasLoot ?? false, createdBy: OWNER, now: new Date(NOW.getTime() - 3 * 3600000), cta: true,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }],
    slots2: [{ role: "Tank", weapon: "Axe" }, { role: "DPS", weapon: "Bow" }],
  });
  await setMessageId(sql, id, "m1");
  await sql`insert into content_message (guild_id, content_id, party, message_id) values ('g1', ${id}, 2, 'm2')`;
  const slots = (await getRosterView(sql, id, NOW))!.slots;
  const edits: { message: string; body: any }[] = [];
  const posts: { channel: string; body: any }[] = [];
  const rest: Rest = {
    async createMessage(channel, body) { posts.push({ channel, body }); return { id: "p" }; },
    async editMessage(_c, message, body) { edits.push({ message, body }); },
    async deleteMessage() {},
    async createDm(u) { return `dm-${u}`; },
  };
  let now = NOW;
  const deps: Deps = { sql, rest, now: () => now };
  const seat = (n: number, user: string) => claimSlot(sql, { contentId: id, slotId: slots[n]!.id, userId: user, guildId: "g1", now: NOW });
  return { sql, id, slots, deps, edits, posts, seat, setNow: (t: Date) => { now = t; } };
}
const who = (userId: string) => ({ user: { id: userId }, roles: [] as string[] });
const command = (sub: string, userId = OWNER): Interaction => ({
  id: "i", type: 2, application_id: "a", token: "t", guild_id: "g1", channel_id: "t1",
  channel: { id: "t1", type: 11, parent_id: "fp" }, member: who(userId),
  data: { name: "content", options: [{ name: sub, type: 1 }] },
});
const button = (customId: string, userId = OWNER): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1", member: who(userId),
  data: { custom_id: customId, component_type: 2 },
});
const bothEdited = (edits: { message: string }[]) => assert.deepEqual([...new Set(edits.map((e) => e.message))].sort(), ["m1", "m2"]);

test("Ping reaches a party 2 player once and a fill once, and the link goes to party 1's message", async () => {
  const { deps, sql, id, seat, posts } = await setup();
  await seat(0, "p1"); await seat(2, "p2");
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status) values ('g1', ${id}, 'f1', null, 'fill')`;
  const r: any = await handlePing(deps, { ...button(`ping:${id}`), message: { id: "m1", flags: 1 << 15 } } as Interaction);
  assert.ok(r.data.content.includes("Sent to 3 of 3 players"), r.data.content);
  const to = (u: string) => posts.filter((p) => p.channel === `dm-${u}`);
  for (const u of ["p1", "p2", "f1"]) assert.equal(to(u).length, 1);
  assert.ok(to("p2")[0]!.body.content.includes("/t1/m1"));
});

test("Ping: a player in both parties' lists (seat in party 2 plus a fill) is pinged once", async () => {
  const { deps, sql, id, seat, posts } = await setup();
  await seat(2, "p2");
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status) values ('g1', ${id}, 'p2', null, 'fill') on conflict do nothing`;
  await handlePing(deps, { ...button(`ping:${id}`), message: { id: "m1", flags: 1 << 15 } } as Interaction);
  assert.equal(posts.filter((p) => p.channel === "dm-p2").length, 1);
});

test("Ping dims the button on both messages and pings nobody twice", async () => {
  const { deps, id, seat, edits, posts } = await setup();
  await seat(0, "p1"); await seat(3, "p2");
  const press = () => handlePing(deps, { ...button(`ping:${id}`), message: { id: "m1", flags: 1 << 15 } } as Interaction);
  await press();
  bothEdited(edits);
  const before = posts.length;
  const again: any = await press();
  assert.ok(again.data.content.includes("Nobody is left to ping"));
  assert.equal(posts.length, before);
});

test("Cancel greys both party messages, with no live control left", async () => {
  const { deps, sql, id, edits } = await setup();
  await handleCancelButton(deps, button(`cancelyes:${id}`));
  assert.equal((await getRosterView(sql, id, NOW))!.status, "cancelled");
  assert.deepEqual(edits.map((e) => e.message).sort(), ["m1", "m2"]);
  for (const e of edits) for (const c of flatComponents(e.body)) {
    if (c.custom_id?.startsWith("vote:") || c.custom_id?.startsWith("ping:") || c.custom_id?.startsWith("mg:")) assert.ok(c.disabled, c.custom_id);
  }
});

test("Lock and unlock refresh both messages", async () => {
  const { deps, edits } = await setup();
  await handleLock(deps, command("lock"));
  bothEdited(edits);
  edits.length = 0;
  await handleUnlock(deps, command("unlock"));
  bothEdited(edits);
});

test("End and reopen refresh both messages", async () => {
  const { deps, edits, setNow } = await setup();
  setNow(new Date(START.getTime() + 10 * 60000));
  await handleEnd(deps, command("end"));
  bothEdited(edits);
  edits.length = 0;
  await handleReopen(deps, command("reopen"));
  bothEdited(edits);
});

test("party 2's message has no vote, Ping or Manage button, even with a loot vote", async () => {
  const { sql, id } = await setup({ hasLoot: true });
  const v = (await getRosterView(sql, id, NOW))!;
  const ids = (n: number) => flatComponents(renderRosterMessage(v, n)).map((c: any) => String(c.custom_id ?? ""));
  assert.ok(ids(1).some((x) => x.startsWith("vote:")));
  assert.ok(!ids(2).some((x) => x.startsWith("vote:") || x.startsWith("ping:") || x.startsWith("mg:")));
});

test("the reminder pings both parties' players and the vote result job refreshes both messages", async () => {
  const { deps, seat, posts, edits, setNow } = await setup({ hasLoot: true });
  await seat(0, "alice"); await seat(2, "bob");
  setNow(new Date(START.getTime() - 25 * 60000));
  assert.equal(await sendReminders(deps), 1);
  assert.ok(posts[0]!.body.content.includes("<@alice>") && posts[0]!.body.content.includes("<@bob>"));
  assert.deepEqual(posts[0]!.body.allowed_mentions, { users: ["alice", "bob"] });
  setNow(new Date(START.getTime() - 4 * 60000));
  assert.equal(await postVoteResults(deps), 1);
  bothEdited(edits);
});

test("auto-end ends a two-party content and refreshes both messages", async () => {
  const { deps, sql, id, edits, setNow } = await setup();
  setNow(new Date(START.getTime() + AUTO_END_MS));
  assert.equal(await endStale(deps), 1);
  assert.equal((await getRosterView(sql, id, NOW))!.status, "done");
  assert.deepEqual(edits.map((e) => e.message).sort(), ["m1", "m2"]);
});

async function fill(seat: (n: number, u: string) => Promise<unknown>) {
  await seat(0, "a"); await seat(1, "b"); await seat(2, "c");
}

test("the calendar and /content list show the total across both parties, with the Open link on party 1", async () => {
  const { deps, sql, seat } = await setup();
  await fill(seat);
  const [e] = await listSchedule(sql, "g1", NOW);
  assert.deepEqual([e!.party, e!.total, e!.messageId], [3, 4, "m1"]);
  const r: any = await handleListCommand(deps, { ...command("list") });
  assert.ok(r.data.content.includes("3/4"), r.data.content);
  assert.ok(r.data.content.includes("/t1/m1"));
});
