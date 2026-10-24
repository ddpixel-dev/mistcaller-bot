import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setMessageId } from "../../src/db/content.ts";
import { claimSlot, joinFill, joinWaitlist } from "../../src/db/signup.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { discordProblems, flatComponents, plain, textOf } from "../helpers/discordLimits.ts";
import { renderRosterMessage } from "../../src/render/roster.ts";

const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 60 * 60000);
const [OWNER, A, B, C, STRANGER, ADMIN] = ["100000000000000001", "100000000000000002", "100000000000000003", "100000000000000004", "100000000000000005", "100000000000000006"];
const V2 = 1 << 15;
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup() {
  const sql = await testSql();
  await sql`insert into guild_admin_role (guild_id, role_id) values ('g1', 'admins')`;
  const id = await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvp", title: "Raid", notes: null, startsAt: START, tier: "T8", hasLoot: false, createdBy: OWNER, now: NOW,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }, { role: "DPS", weapon: "Bow" }],
  });
  await setMessageId(sql, id, "m1");
  const slots = (await getRosterView(sql, id, NOW))!.slots.map((s) => s.id);
  const edits: any[] = [], posts: { channel: string; body: any }[] = [];
  const rest: Rest = {
    async createMessage(channel, body) { posts.push({ channel, body }); return { id: "x" }; },
    async editMessage(_c, _m, body) { edits.push(body); },
    async deleteMessage() {},
    async memberName(_g, u) { return `Name-${u.slice(-1)}`; },
  };
  const deps: Deps = { sql, rest, now: () => NOW };
  return { sql, id, slots, deps, d: createDispatch(deps), edits, posts };
}
const who = (id: string, roles: string[] = []) => ({ user: { id }, roles });
const click = (customId: string, user: string, values?: unknown[], over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1", channel: { id: "t1", type: 11 },
  message: { id: "m1", flags: V2 }, member: who(user),
  data: { custom_id: customId, component_type: values ? 3 : 2, ...(values ? { values } : {}) }, ...over,
});
const text = (r: any) => String(r.data.content ?? "");
const seat = (sql: any, id: string, slot: string, user: string) => claimSlot(sql, { contentId: id, slotId: slot, userId: user, guildId: "g1", now: NOW });

test("Remove player opens a private panel listing everyone on the roster: seated, fills and the waitlist", async () => {
  const { d, id, sql, slots } = await setup();
  await seat(sql, id, slots[0]!, A);
  await joinFill(sql, { contentId: id, userId: B, guildId: "g1", now: NOW });
  await seat(sql, id, slots[1]!, C);
  await joinWaitlist(sql, { contentId: id, userId: STRANGER, guildId: "g1", role: "Healer", now: NOW });
  const r: any = await d(click(`rm:${id}`, OWNER));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  const menu = r.data.components[0].components[0];
  assert.equal(menu.custom_id, `rm:p:${id}`);
  assert.deepEqual(menu.options.map((o: any) => o.value), [A, C, B, STRANGER], "seated by position, then fills, then the waitlist");
  assert.ok(menu.options[0].label.includes("Name-2") && menu.options[0].description.includes("Tank"));
  assert.ok(menu.options[2].description.includes("Fill") && menu.options[3].description.includes("Waitlist"));
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
  assert.deepEqual(discordProblems({ ...r.data, flags: 0 }), []);
});

test("only the creator and admins may use it; strangers, old rosters and an empty roster are refused", async () => {
  const { d, id, sql, slots } = await setup();
  assert.ok(text(await d(click(`rm:${id}`, OWNER))).includes("Nobody is signed up"));
  await seat(sql, id, slots[0]!, A);
  assert.ok(text(await d(click(`rm:${id}`, STRANGER))).includes("Only the creator"));
  assert.ok(text(await d(click(`rm:p:${id}`, STRANGER, [A]))).includes("Only the creator"));
  assert.equal(((await d(click(`rm:${id}`, ADMIN, undefined, { member: who(ADMIN, ["admins"]) }))) as any).type, 4);
  assert.equal(((await d(click(`rm:${id}`, OWNER, undefined, { message: { id: "p1", flags: 64 } }))) as any).type, 4, "opened from the private Manage panel");
  assert.equal((await getRosterView(sql, id, NOW))!.slots[0]!.userId, A, "nothing was removed");
});

test("choosing a seated player removes them, serves the waitlist, refreshes the roster and mentions only the removed member", async () => {
  const { d, id, sql, slots, edits, posts } = await setup();
  await seat(sql, id, slots[0]!, A);
  await joinWaitlist(sql, { contentId: id, userId: B, guildId: "g1", role: "Tank", now: NOW });
  const r: any = await d(click(`rm:p:${id}`, OWNER, [A], { message: { id: "p1", flags: 64 } }));
  assert.equal(r.type, 7);
  assert.ok(text(r).includes(`<@${A}>`) && text(r).includes("removed"));
  const v = (await getRosterView(sql, id, NOW))!;
  assert.equal(v.slots[0]!.userId, B, "the first waiter took the freed position");
  assert.equal(edits.length, 1);
  const removed = posts.find((p) => p.body.content.includes("was removed"))!;
  assert.ok(removed.body.content.includes(`<@${A}>`) && removed.body.content.includes(`<@${OWNER}>`));
  assert.deepEqual(removed.body.allowed_mentions, { users: [A] });
  const promo = posts.find((p) => p.body.content.includes("a position opened for you"))!;
  assert.ok(promo.body.content.includes(`<@${B}>`));
});

test("a fill and a waiting member can be removed too, and someone no longer on the roster is refused", async () => {
  const { d, id, sql } = await setup();
  await joinFill(sql, { contentId: id, userId: A, guildId: "g1", now: NOW });
  await joinWaitlist(sql, { contentId: id, userId: B, guildId: "g1", role: "Tank", now: NOW }).catch(() => {});
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status, wait_role) values ('g1', ${id}, ${B}, null, 'waitlist', 'Tank') on conflict do nothing`;
  assert.equal(((await d(click(`rm:p:${id}`, OWNER, [A], { message: { id: "p1", flags: 64 } }))) as any).type, 7);
  assert.equal(((await d(click(`rm:p:${id}`, OWNER, [B], { message: { id: "p1", flags: 64 } }))) as any).type, 7);
  assert.equal((await getRosterView(sql, id, NOW))!.fills!.length, 0);
  assert.equal((await getRosterView(sql, id, NOW))!.waitlist!.length, 0);
  assert.ok(text(await d(click(`rm:p:${id}`, OWNER, [A], { message: { id: "p1", flags: 64 } }))).includes("not on the roster"));
  assert.ok(text(await d(click(`rm:p:${id}`, OWNER, ["nope"], { message: { id: "p1", flags: 64 } }))).includes("out of date"));
  assert.ok(text(await d(click("rm:nope", OWNER))).includes("out of date"));
});

test("the roster has no Remove player button; it lives in the Manage panel (ADR 0028)", async () => {
  const { sql, id, slots } = await setup();
  await seat(sql, id, slots[0]!, A);
  await joinFill(sql, { contentId: id, userId: B, guildId: "g1", now: NOW });
  await sql`update content set has_loot = true`;
  const msg: any = renderRosterMessage((await getRosterView(sql, id, NOW))!);
  assert.equal(flatComponents(msg).find((c) => c.custom_id === `rm:${id}`), undefined);
  assert.deepEqual(discordProblems(msg), []);
  assert.ok(plain(textOf(msg)).length > 0);
});
