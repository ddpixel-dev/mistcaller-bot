import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setMessageId } from "../../src/db/content.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup() {
  const sql = await testSql();
  await sql`insert into guild_settings (guild_id, pvp_forum_id, pve_forum_id, officer_role_id) values ('g1', 'fp', 'fe', 'officer')`;
  const id = await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvp", title: "Ganking", notes: null, startsAt: new Date("2026-12-01T18:00:00Z"),
    tier: { min: { tier: 8, enchant: 0 }, max: null }, hasLoot: false, createdBy: "boss",
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }],
  });
  await setMessageId(sql, id, "m1");
  const edits: any[] = [];
  const rest: Rest = {
    async createMessage() { return { id: "p" }; },
    async editMessage(channelId, messageId, body) { edits.push({ channelId, messageId, body }); },
    async deleteMessage() {},
  };
  const deps: Deps = { sql, rest, now: () => NOW };
  const slots = (await getRosterView(sql, id, NOW))!.slots.map((s) => s.id);
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status) values ('g1', ${id}, 'alice', ${slots[0]}, 'signed')`;
  return { sql, deps, d: createDispatch(deps), id, edits };
}
const duty = (position: unknown, value: unknown, userId = "boss", roles: string[] = [], permissions?: string): Interaction => ({
  id: "i", type: 2, application_id: "a", token: "t", guild_id: "g1", channel_id: "t1",
  channel: { id: "t1", type: 11, parent_id: "fp" }, member: { user: { id: userId }, roles, permissions },
  data: { name: "content", options: [{ name: "duty", type: 1, options: [{ name: "position", type: 4, value: position }, { name: "duty", type: 3, value }] }] },
});
const text = (r: any) => r.data.content as string;

test("the creator assigns a duty to a held position: saved and shown on the roster message", async () => {
  const { d, sql, id, edits } = await setup();
  const r = await d(duty(1, "caller"));
  assert.ok(text(r).includes("Caller assigned for position 1."));
  assert.equal((await getRosterView(sql, id, NOW))!.slots[0]!.duty, "caller");
  assert.equal(edits.length, 1);
  assert.ok(edits[0].body.embeds[0].description.includes("sworn: <@alice> · 📯 Caller"));
  assert.ok(text(await d(duty(1, "none"))).includes("Duty cleared"));
  assert.equal((await getRosterView(sql, id, NOW))!.slots[0]!.duty, null);
});

test("officers and Manage Server may assign; strangers may not", async () => {
  const { d, sql, id } = await setup();
  assert.ok(text(await d(duty(1, "scout", "x", ["officer"]))).includes("Scout assigned"));
  assert.ok(text(await d(duty(1, "rat", "y", [], "32"))).includes("Rat assigned"));
  assert.ok(text(await d(duty(1, "caller", "stranger"))).includes("Only the creator"));
  assert.equal((await getRosterView(sql, id, NOW))!.slots[0]!.duty, "rat");
});

test("an open position, a missing position, bad input and no content are explained", async () => {
  const { d, sql, id } = await setup();
  assert.ok(text(await d(duty(2, "caller"))).includes("is open"));
  assert.ok(text(await d(duty(9, "caller"))).includes("no position 9"));
  assert.ok(text(await d(duty(0, "caller"))).includes("1 to 20"));
  assert.ok(text(await d(duty(1.5, "caller"))).includes("1 to 20"));
  assert.ok(text(await d(duty("1", "caller"))).includes("1 to 20"));
  assert.ok(text(await d(duty(1, "captain"))).includes("from the list"));
  assert.ok(text(await d(duty(1, 5))).includes("from the list"));
  const other: Interaction = { ...duty(1, "caller"), channel: { id: "other", type: 11, parent_id: "fp" } };
  assert.ok(text(await d(other)).includes("no active content"));
  await sql`update content set status = 'cancelled' where id = ${id}`;
  assert.ok(text(await d(duty(1, "caller"))).includes("no active content"));
});

test("a failed roster edit still saves the duty and says the message will update later", async () => {
  const { d, deps, sql, id } = await setup();
  deps.rest.editMessage = async () => { throw new Error("boom"); };
  assert.ok(text(await d(duty(1, "caller"))).includes("will update on the next change"));
  assert.equal((await getRosterView(sql, id, NOW))!.slots[0]!.duty, "caller");
});
