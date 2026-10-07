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
  return { sql, deps, d: createDispatch(deps), id, slots, edits };
}
const base = (userId = "u1", over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1", channel_id: "t1",
  channel: { id: "t1", type: 11, parent_id: "fp" }, member: { user: { id: userId }, roles: [] }, ...over,
});
const command = (userId = "u1", over: Partial<Interaction> = {}) =>
  base(userId, { type: 2, data: { name: "content", options: [{ name: "me", type: 1 }] }, ...over });
const press = (customId: string, values?: unknown[], userId = "u1", over: Partial<Interaction> = {}) =>
  base(userId, { data: { custom_id: customId, component_type: values ? 3 : 2, ...(values ? { values } : {}) }, ...over });
const leaveBtn = (r: any) => r.data.components.flatMap((row: any) => row.components).find((c: any) => c.custom_id?.startsWith("me:leave"));
const holders = async (sql: any, id: string) => (await getRosterView(sql, id, NOW))!.slots.map((s) => s.userId);

test("not signed up: a private panel with a sign-up menu and a dimmed Leave button", async () => {
  const { d, id } = await setup();
  const r: any = await d(command());
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.ok(r.data.content.includes("You are not signed up."));
  assert.equal(r.data.components[0].components[0].placeholder, "Sign up for a position");
  assert.equal(leaveBtn(r).disabled, true);
  assert.equal(leaveBtn(r).custom_id, `me:leave:${id}`);
});

test("signing up from the panel updates the roster message and enables Leave for this member only", async () => {
  const { sql, d, id, slots, edits } = await setup();
  const r: any = await d(press(`me:pick:${id}`, [slots[0]]));
  assert.equal(r.type, 7);
  assert.ok(r.data.content.includes("You are signed up as 1. Tank - Mace."));
  assert.equal(r.data.components[0].components[0].placeholder, "Move to another position");
  assert.equal(leaveBtn(r).disabled, false);
  assert.deepEqual(await holders(sql, id), ["u1", null]);
  assert.equal(edits.length, 1);
  assert.deepEqual([edits[0].channelId, edits[0].messageId], ["t1", "m1"]);
  assert.ok(edits[0].body.embeds[0].description.includes("sworn: <@u1>"));
  const other: any = await d(command("u2"));
  assert.equal(leaveBtn(other).disabled, true);
  assert.ok(other.data.components[0].components[0].options[0].description === "Taken");
});

test("moving and leaving from the panel update the roster", async () => {
  const { sql, d, id, slots, edits } = await setup();
  await d(press(`me:pick:${id}`, [slots[0]]));
  const moved: any = await d(press(`me:pick:${id}`, [slots[1]]));
  assert.ok(moved.data.content.includes("2. Healer - Holy"));
  assert.deepEqual(await holders(sql, id), [null, "u1"]);
  const left: any = await d(press(`me:leave:${id}`));
  assert.equal(left.type, 7);
  assert.ok(left.data.content.includes("You are not signed up."));
  assert.equal(leaveBtn(left).disabled, true);
  assert.deepEqual(await holders(sql, id), [null, null]);
  assert.equal(edits.length, 3);
});

test("refusals are private and change nothing: own slot again, taken slot, not signed, tampering", async () => {
  const { sql, d, id, slots } = await setup();
  const refused = (r: any, text?: string) => { assert.equal(r.data.flags, 64); if (text) assert.ok(r.data.content.includes(text), r.data.content); };
  await d(press(`me:pick:${id}`, [slots[0]]));
  refused(await d(press(`me:pick:${id}`, [slots[0]])), "already hold");
  refused(await d(press(`me:pick:${id}`, [slots[0]], "u2")), "taken");
  refused(await d(press(`me:leave:${id}`, undefined, "u2")), "not signed up");
  for (const bad of ["me:leave:nope", `me:zzz:${id}`, `me:leave:${id}:x`, "me::"]) refused(await d(press(bad)));
  refused(await d(press(`me:pick:${id}`, ["nope"])));
  refused(await d(press(`me:pick:${id}`, [slots[0], slots[1]])));
  refused(await d(press(`me:leave:${id}`, undefined, "u1", { guild_id: "g2" })));
  assert.deepEqual(await holders(sql, id), ["u1", null]);
});

test("a failed roster edit does not undo the change", async () => {
  const { sql, deps, d, id, slots } = await setup();
  deps.rest.editMessage = async () => { throw new Error("boom"); };
  assert.equal(((await d(press(`me:pick:${id}`, [slots[0]]))) as any).type, 7);
  assert.deepEqual(await holders(sql, id), ["u1", null]);
});

test("after the start the panel is closed for moves but still lets a signed-up member leave; none without content", async () => {
  const { sql, d, id, slots } = await setup();
  await d(press(`me:pick:${id}`, [slots[0]]));
  await sql`update content set status = 'locked' where id = ${id}`;
  const r: any = await d(command());
  assert.ok(r.data.content.includes("closed"));
  assert.equal(r.data.components.length, 1);
  assert.equal(leaveBtn(r).disabled, false);
  assert.equal(((await d(press(`me:leave:${id}`))) as any).type, 7);
  await sql`update content set status = 'cancelled' where id = ${id}`;
  assert.ok(((await d(command())) as any).data.content.includes("no active content"));
  assert.ok(((await d(command("u1", { channel: { id: "other", type: 11, parent_id: "fp" } }))) as any).data.content.includes("no active content"));
});
