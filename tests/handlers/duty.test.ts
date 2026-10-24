import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { textOf } from "../helpers/discordLimits.ts";
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
  await sql`insert into guild_admin_role (guild_id, role_id) values ('g1', 'officer')`;
  const id = await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvp", title: "Ganking", notes: null, startsAt: new Date("2026-12-01T18:00:00Z"),
    tier: "T8.0", hasLoot: false, createdBy: "boss",
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
// Set duty is a button of the Manage panel (ADR 0029): a position, then a duty. `duty` is the second click.
const duty = (id: string, position: unknown, value: unknown, userId = "boss", roles: string[] = [], permissions?: string): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1", channel_id: "t1",
  channel: { id: "t1", type: 11, parent_id: "fp" }, member: { user: { id: userId }, roles, permissions }, message: { id: "p1", flags: 64 },
  data: { custom_id: `dt:d:${id}:${position}`, component_type: 3, values: [value] },
});
const text = (r: any) => r.data.content as string;

test("the creator assigns a duty to a held position: saved and shown on the roster message", async () => {
  const { d, sql, id, edits } = await setup();
  const r = await d(duty(id, 1, "caller"));
  assert.ok(text(r).includes("Caller assigned for position 1."));
  assert.equal((await getRosterView(sql, id, NOW))!.slots[0]!.duty, "caller");
  assert.equal(edits.length, 1);
  assert.ok(textOf(edits[0].body).includes("<@alice> - 📯 Caller"));
  assert.ok(text(await d(duty(id, 1, "none"))).includes("Duty cleared"));
  assert.equal((await getRosterView(sql, id, NOW))!.slots[0]!.duty, null);
});

test("officers and Manage Server may assign; strangers may not", async () => {
  const { d, sql, id } = await setup();
  assert.ok(text(await d(duty(id, 1, "scout", "x", ["officer"]))).includes("Scout assigned"));
  assert.ok(text(await d(duty(id, 1, "rat", "y", [], "32"))).includes("Rat assigned"));
  assert.ok(text(await d(duty(id, 1, "caller", "stranger"))).includes("Only the creator"));
  assert.equal((await getRosterView(sql, id, NOW))!.slots[0]!.duty, "rat");
});

test("an open position, a missing position, bad input and cancelled content are explained", async () => {
  const { d, sql, id } = await setup();
  assert.ok(text(await d(duty(id, 2, "caller"))).includes("Caller assigned for position 2."));
  assert.equal((await getRosterView(sql, id, NOW))!.slots[1]!.duty, "caller");
  assert.ok(text(await d(duty(id, 9, "caller"))).includes("no position 9"));
  for (const bad of [0.5, "x", "999"]) assert.ok(text(await d(duty(id, bad, "caller"))).includes("out of date"), String(bad));
  assert.ok(text(await d(duty(id, 1, "captain"))).includes("out of date"));
  assert.ok(text(await d(duty(id, 1, 5))).includes("out of date"));
  await sql`update content set status = 'cancelled' where id = ${id}`;
  assert.ok(text(await d(duty(id, 1, "caller"))).includes("no longer open"));
});

test("a failed roster edit still saves the duty", async () => {
  const { d, deps, sql, id } = await setup();
  deps.rest.editMessage = async () => { throw new Error("boom"); };
  assert.ok(text(await d(duty(id, 1, "caller"))).includes("Caller assigned"));
  assert.equal((await getRosterView(sql, id, NOW))!.slots[0]!.duty, "caller");
});
