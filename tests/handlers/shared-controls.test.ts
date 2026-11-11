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
import { renderMovedNote, renderRosterMessage } from "../../src/render/roster.ts";
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
// This setup is a CTA posted with 0.31.8 (two messages). ADR 0047: its first refresh gives m1 the whole CTA and turns
// m2 into the moved note once; later refreshes edit m1 only.
const movedOnce = (edits: { message: string; body: any }[]) => assert.deepEqual(edits.filter((e) => e.message === "m2").map((e) => e.body), [renderMovedNote()]);
const onlyM1 = (edits: { message: string }[]) => assert.deepEqual([...new Set(edits.map((e) => e.message))], ["m1"]);

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

const ctl = (body: any, prefix: string, label?: string) =>
  flatComponents(body).filter((c: any) => String(c.custom_id ?? "").startsWith(prefix) && (label === undefined || c.label === label));
const pingBtn = (body: any) => ctl(body, "ping:")[0] as any;

test("Ping: a player cannot be seated and a fill at once (one signup row per player), so each is pinged once", async () => {
  const { deps, sql, id, seat, posts } = await setup();
  await seat(2, "p2");
  await assert.rejects(
    sql`insert into signup (guild_id, content_id, user_id, slot_id, status) values ('g1', ${id}, 'p2', null, 'fill')`,
    /duplicate key|signup_pkey/,
  );
  assert.equal((await sql`select 1 from signup where content_id = ${id} and user_id = 'p2'`).length, 1);
  await handlePing(deps, { ...button(`ping:${id}`), message: { id: "m1", flags: 1 << 15 } } as Interaction);
  assert.equal(posts.filter((p) => p.channel === "dm-p2").length, 1);
});

test("Ping dims the button on party 1's message once nobody is left, turns party 2's into the note, and pings nobody twice", async () => {
  const { deps, id, seat, edits, posts } = await setup();
  await seat(0, "p1"); await seat(3, "p2");
  const press = () => handlePing(deps, { ...button(`ping:${id}`), message: { id: "m1", flags: 1 << 15 } } as Interaction);
  await press();
  const m1 = edits.find((e) => e.message === "m1")!.body;
  assert.equal(pingBtn(m1).disabled, true, "nobody left to ping");
  movedOnce(edits);
  assert.ok(ctl(m1, "leave:").length === 1 && (ctl(m1, "leave:")[0] as any).disabled === false, "the shared Leave is live: p2 sits in party 2");
  const before = posts.length;
  const again: any = await press();
  assert.ok(again.data.content.includes("Nobody is left to ping"));
  assert.equal(posts.length, before);
});

// Every interactive control of a body: buttons and select menus.
const interactive = (body: any) => flatComponents(body).filter((c: any) => c.custom_id !== undefined);

test("Cancel renders the CTA cancelled (no menu, every button disabled) and party 2's message becomes the note", async () => {
  const { deps, sql, id, edits, seat } = await setup();
  await seat(0, "p1"); await seat(2, "p2");
  await handleCancelButton(deps, button(`cancelyes:${id}`));
  assert.equal((await getRosterView(sql, id, NOW))!.status, "cancelled");
  assert.deepEqual(edits.map((e) => e.message).sort(), ["m1", "m2"]);
  const view = (await getRosterView(sql, id, NOW))!;
  const body = edits.find((x) => x.message === "m1")!.body;
  assert.deepEqual(body, renderRosterMessage(view), "m1 is the cancelled render of the whole CTA");
  const controls = interactive(body);
  assert.ok(controls.length > 0);
  assert.ok(controls.every((c: any) => c.type === 2 && c.disabled === true), "every control is a disabled button");
  assert.ok(JSON.stringify(body).includes("Cancelled"));
  assert.equal(ctl(body, "leave:", "Leave").length, 1);
  movedOnce(edits);
});

test("Lock closes both parties' join menus on the one message; unlock brings them back", async () => {
  const { deps, edits } = await setup();
  const joinMenu = (n: string) => ctl(edits.find((e) => e.message === n)!.body, "join:");
  await handleLock(deps, command("lock"));
  bothEdited(edits);
  movedOnce(edits);
  assert.equal(joinMenu("m1").length, 0, "no join menu while locked");
  edits.length = 0;
  await handleUnlock(deps, command("unlock"));
  onlyM1(edits);
  // ADR 0047: one join menu per party in the one message.
  assert.equal(joinMenu("m1").length, 2, "both parties can be joined again");
  assert.ok(joinMenu("m1").some((c: any) => c.custom_id.endsWith("@2")), "with party 2's menu");
});

test("End greys the CTA (done, no join menu, Leave disabled); reopen makes it live again", async () => {
  const { deps, edits, seat, setNow } = await setup();
  await seat(0, "p1"); await seat(2, "p2");
  setNow(new Date(START.getTime() + 10 * 60000));
  await handleEnd(deps, command("end"));
  bothEdited(edits);
  movedOnce(edits);
  const done = edits.find((e) => e.message === "m1")!.body;
  assert.equal(ctl(done, "join:").length, 0, "no join menu when done");
  assert.equal((ctl(done, "leave:")[0] as any).disabled, true, "Leave disabled when done");
  assert.ok(JSON.stringify(done).includes("Concluded"));
  edits.length = 0;
  await handleReopen(deps, command("reopen"));
  onlyM1(edits);
  const live = edits.find((e) => e.message === "m1")!.body;
  assert.equal(ctl(live, "join:").length, 2, "both parties' join menus are back after reopen");
  assert.equal((ctl(live, "leave:")[0] as any).disabled, false, "Leave live after reopen");
  assert.ok(!JSON.stringify(edits.find((e) => e.message === "m1")!.body).includes("Concluded"));
});

test("a CTA is one message: the vote, Ping and Manage appear once, whatever party is asked for (ADR 0047)", async () => {
  const { sql, id } = await setup({ hasLoot: true });
  const v = (await getRosterView(sql, id, NOW))!;
  const ids = (n: number) => flatComponents(renderRosterMessage(v, n)).map((c: any) => String(c.custom_id ?? ""));
  assert.deepEqual(ids(2), ids(1));
  for (const pre of ["vote:", "ping:", "mg:"]) assert.ok(ids(1).some((x) => x.startsWith(pre)), pre);
  assert.equal(ids(1).filter((x) => x.startsWith("ping:")).length, 1);
});

test("the reminder pings both parties' players and the vote result job refreshes both messages", async () => {
  const { deps, seat, posts, edits, setNow } = await setup({ hasLoot: true });
  await seat(0, "alice"); await seat(2, "bob");
  setNow(new Date(START.getTime() - 25 * 60000));
  assert.equal(await sendReminders(deps), 1);
  assert.ok(posts[0]!.body.content.includes("<@alice>") && posts[0]!.body.content.includes("<@bob>"));
  assert.deepEqual(posts[0]!.body.allowed_mentions, { users: ["alice", "bob"] });
  setNow(new Date(START.getTime() - 4 * 60000));
  edits.length = 0; posts.length = 0;
  assert.equal(await postVoteResults(deps), 1);
  bothEdited(edits);
  assert.equal(posts.length, 1);
  assert.ok(posts[0]!.body.content.includes("Loot vote result: no votes"), posts[0]!.body.content);
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
