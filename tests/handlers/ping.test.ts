import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setMessageId } from "../../src/db/content.ts";
import { claimSlot } from "../../src/db/signup.ts";
import { handlePing } from "../../src/handlers/ping.ts";
import { renderRosterMessage } from "../../src/render/roster.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { discordProblems, flatComponents } from "../helpers/discordLimits.ts";

const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 40 * 60000);
const OWNER = "100000000000000001", A = "100000000000000002", B = "100000000000000003", C = "100000000000000004";
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup(closedDms: string[] = []) {
  const sql = await testSql();
  const id = await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvp", title: "Raid *night*", notes: null, startsAt: START,
    tier: "T8.0", hasLoot: false, createdBy: OWNER, now: NOW,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }, { role: "DPS", weapon: "Bow" }, { role: "DPS", weapon: "Axe" }],
  });
  await setMessageId(sql, id, "m1");
  const slots = (await getRosterView(sql, id, NOW))!.slots.map((s) => s.id);
  for (const [n, u] of [OWNER, A, B].entries()) await claimSlot(sql, { contentId: id, slotId: slots[n]!, userId: u, guildId: "g1", now: NOW });
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status, wait_role) values ('g1', ${id}, ${C}, null, 'waitlist', 'DPS')`;
  const sent: { channel: string; body: any }[] = [];
  const rest: Rest = {
    async createMessage(channel, body) { sent.push({ channel, body }); return { id: "x" }; },
    async editMessage() {}, async deleteMessage() {},
    async createDm(user) { if (closedDms.includes(user)) throw new Error("DMs closed"); return `dm-${user}`; },
  };
  const deps: Deps = { sql, rest, now: () => NOW };
  return { sql, id, deps, d: createDispatch(deps), sent };
}
const press = (id: string, user: string, over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1", message: { id: "m1", flags: 1 << 15 },
  member: { user: { id: user }, roles: [] }, data: { custom_id: `ping:${id}`, component_type: 2 }, ...over,
});
const text = (r: any) => r.data.content as string;

test("the owner's ping sends a private message to every signed-up player and a copy to the owner, not to the waitlist", async () => {
  const { id, d, sent } = await setup();
  const r: any = await d(press(id, OWNER));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.ok(text(r).includes("Sent to 2 of 2 players, and a copy to you."));
  assert.deepEqual(sent.map((s) => s.channel).sort(), [`dm-${OWNER}`, `dm-${A}`, `dm-${B}`]);
  const copy = sent.find((s) => s.channel === `dm-${OWNER}`)!.body;
  assert.ok(copy.content.includes("Your copy") && copy.content.includes("Raid \\*night\\*"));
  assert.ok(!sent.find((s) => s.channel === `dm-${A}`)!.body.content.includes("Your copy"));
  const body = sent.find((s) => s.channel === `dm-${A}`)!.body;
  assert.ok(body.content.includes("Raid \\*night\\*"));
  assert.ok(body.content.includes(`<t:${Math.floor(START.getTime() / 1000)}:R>`));
  assert.ok(body.content.includes("https://discord.com/channels/g1/t1/m1"));
  assert.ok(body.content.includes(`<@${OWNER}>`));
  assert.deepEqual(body.allowed_mentions, { parse: [] });
});

test("players who cannot be reached are named to the owner, and the others still get it", async () => {
  const { id, d, sent } = await setup([B]);
  const r: any = await d(press(id, OWNER));
  assert.ok(text(r).includes("Sent to 1 of 2 players, and a copy to you."));
  assert.ok(text(r).includes(`<@${B}>`) && text(r).includes("closed"));
  assert.deepEqual(sent.map((s) => s.channel).sort(), [`dm-${OWNER}`, `dm-${A}`]);
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
});

test("only the owner can ping; anyone else is told so and nothing is sent", async () => {
  const { id, d, sent } = await setup();
  for (const user of [A, "999999999999999999"]) {
    const r: any = await d(press(id, user));
    assert.equal(r.data.flags, 64);
    assert.ok(text(r).includes("Only the owner"));
  }
  assert.equal(sent.length, 0);
});

test("ping is refused for finished or cancelled content, an empty roster, old rosters, bad ids and other servers", async () => {
  const { sql, id, d, sent } = await setup();
  assert.ok(text(await d(press(id, OWNER, { message: { id: "m0", flags: 0 } }))).includes("older layout"));
  assert.ok(text(await d(press("nope", OWNER))).includes("not valid"));
  assert.ok(text(await d(press(id, OWNER, { guild_id: "g2" }))).includes("no longer exists"));
  assert.ok(text(await d(press(id, OWNER, { member: undefined }))).includes("not valid"));
  for (const s of ["cancelled", "done"]) {
    await sql`update content set status = ${s}`;
    assert.ok(text(await d(press(id, OWNER))).includes("finished or cancelled"));
  }
  await sql`update content set status = 'open'`;
  await sql`delete from signup where user_id <> ${OWNER}`;
  assert.ok(text(await d(press(id, OWNER))).includes("Nobody else"));
  assert.deepEqual(sent.map((s) => s.channel), [`dm-${OWNER}`], "only the owner's copy");
});

test("the roster carries a Ping button next to Leave, dimmed until someone is signed up and when finished", async () => {
  const { sql, id } = await setup();
  const view = async () => (await getRosterView(sql, id, NOW))!;
  const ping = async () => flatComponents(renderRosterMessage(await view())).find((c) => c.custom_id === `ping:${id}`)!;
  assert.equal((await ping()).label, "Ping players");
  assert.equal((await ping()).disabled, false);
  assert.deepEqual(discordProblems(renderRosterMessage(await view())), []);
  await sql`delete from signup`;
  assert.equal((await ping()).disabled, true);
  await sql`update content set status = 'done'`;
  assert.equal((await ping()).disabled, true);
});

test("a 20-player ping answers well within the time limit", async () => {
  const { sql, id, deps } = await setup();
  for (let n = 0; n < 17; n++) {
    const slot = await sql`insert into slot (guild_id, content_id, position, role, weapon) values ('g1', ${id}, ${n + 5}, 'DPS', 'Bow') returning id`;
    await claimSlot(sql, { contentId: id, slotId: slot[0]!.id, userId: (100000000000000100n + BigInt(n)).toString(), guildId: "g1", now: NOW });
  }
  const started = Date.now();
  const r: any = await handlePing(deps, press(id, OWNER));
  assert.ok(text(r).includes("Sent to 19 of 19 players"));
  assert.ok(Date.now() - started < 1500);
});

test("the ping can be used once: the button is dimmed, a second press is refused and nothing more is sent", async () => {
  const { sql, id, d, sent } = await setup();
  const ping = async () => flatComponents(renderRosterMessage((await getRosterView(sql, id, NOW))!)).find((c) => c.custom_id === `ping:${id}`)!;
  assert.equal((await ping()).disabled, false);
  assert.ok(text(await d(press(id, OWNER))).includes("Sent to 2 of 2 players"));
  assert.equal((await ping()).disabled, true);
  const sentOnce = sent.length;
  const again: any = await d(press(id, OWNER));
  assert.equal(again.data.flags, 64);
  assert.ok(text(again).includes("once"));
  assert.equal(sent.length, sentOnce);
});

test("after a ping, the roster message is edited so the button shows as used", async () => {
  const { sql, id, deps } = await setup();
  const edits: any[] = [];
  deps.rest.editMessage = async (_c, _m, body) => { edits.push(body); };
  await handlePing(deps, press(id, OWNER));
  assert.equal(edits.length, 1);
  assert.equal(flatComponents(edits[0]).find((c) => c.custom_id === `ping:${id}`)!.disabled, true);
});

test("when nobody can be reached the ping is not used up", async () => {
  const { sql, id, d } = await setup([A, B]);
  assert.ok(text(await d(press(id, OWNER))).includes("Nobody could be reached"));
  const [row] = await sql`select pinged_at from content where id = ${id}`;
  assert.equal(row!.pinged_at, null);
  assert.equal(flatComponents(renderRosterMessage((await getRosterView(sql, id, NOW))!)).find((c) => c.custom_id === `ping:${id}`)!.disabled, false);
});

test("two simultaneous presses send the messages only once", async () => {
  const { id, deps, sent } = await setup();
  await Promise.all([handlePing(deps, press(id, OWNER)), handlePing(deps, press(id, OWNER))]);
  assert.equal(sent.length, 3, "two players and the owner's copy, once");
});

test("with nobody else signed up, only the owner's copy is sent and the ping is not used up", async () => {
  const { sql, id, d, sent } = await setup();
  await sql`delete from signup where user_id <> ${OWNER}`;
  const r: any = await d(press(id, OWNER));
  assert.ok(text(r).includes("only a copy") && text(r).includes("not used"));
  assert.deepEqual(sent.map((s) => s.channel), [`dm-${OWNER}`]);
  const [row] = await sql`select pinged_at from content where id = ${id}`;
  assert.equal(row!.pinged_at, null);
  assert.equal(flatComponents(renderRosterMessage((await getRosterView(sql, id, NOW))!)).find((c) => c.custom_id === `ping:${id}`)!.disabled, false);
  // later, with players signed up, the real ping still works once
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status) select 'g1', ${id}, ${A}, id, 'signed' from slot where content_id = ${id} and position = 2`;
  assert.ok(text(await d(press(id, OWNER))).includes("Sent to 1 of 1 players"));
});

test("when the owner's own private messages are closed the players still get the ping", async () => {
  const { id, d, sent } = await setup([OWNER]);
  const r: any = await d(press(id, OWNER));
  assert.ok(text(r).includes("Sent to 2 of 2 players."));
  assert.ok(!text(r).includes("copy to you"));
  assert.deepEqual(sent.map((s) => s.channel).sort(), [`dm-${A}`, `dm-${B}`]);
});
