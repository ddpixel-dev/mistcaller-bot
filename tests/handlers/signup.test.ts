import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, type NewContent } from "../../src/db/content.ts";
import { handleSignup, handleLeave } from "../../src/handlers/signup.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const base: NewContent = {
  guildId: "g1", threadId: "t1", type: "pvp", title: "Ganking", notes: null,
  startsAt: new Date("2026-12-01T18:00:00Z"),
  tier: { min: { tier: 8, enchant: 0 }, max: null }, hasLoot: false, createdBy: "u1",
  slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }],
};
const rest: Rest = { async createMessage() { return { id: "m" }; }, async editMessage() {}, async deleteMessage() {} };

beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup() {
  const sql = await testSql();
  const contentId = await createContent(sql, base);
  const other = await createContent(sql, { ...base, threadId: "t2" });
  const v = (await getRosterView(sql, contentId, NOW))!;
  const ov = (await getRosterView(sql, other, NOW))!;
  const deps: Deps = { sql, rest, now: () => NOW };
  return { sql, deps, contentId, otherId: other, slots: v.slots.map((s) => s.id), otherSlots: ov.slots.map((s) => s.id) };
}

const select = (customId: string, values: unknown, over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1",
  member: { user: { id: "u1" }, roles: [] },
  data: { custom_id: customId, component_type: 3, values },
  ...over,
});
const holders = async (sql: any, id: string) => (await getRosterView(sql, id, NOW))!.slots.map((s) => s.userId);
const isEphemeral = (r: any, text?: string) => {
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  if (text) assert.ok(r.data.content.includes(text), r.data.content);
};
const menu = (r: any) => r.data.components[0].components[0];

test("valid selection updates the shared roster message, no private reply", async () => {
  const { sql, deps, contentId, slots } = await setup();
  const r: any = await handleSignup(deps, select(`signup:${contentId}`, [slots[0]]));
  assert.equal(r.type, 7);
  assert.ok(r.data.embeds[0].description.includes("1. Tank - Mace · sworn: <@u1>"));
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
  assert.ok(!menu(r).options.some((o: any) => o.value === "leave"));
  assert.equal(r.data.components[1].components[0].disabled, false);
  assert.deepEqual(await holders(sql, contentId), ["u1", null]);
});

test("moving to another slot updates the message", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleSignup(deps, select(`signup:${contentId}`, [slots[0]]));
  const r: any = await handleSignup(deps, select(`signup:${contentId}`, [slots[1]]));
  assert.equal(r.type, 7);
  assert.deepEqual(await holders(sql, contentId), [null, "u1"]);
});

test("re-selecting the position you already hold is refused privately and changes nothing", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleSignup(deps, select(`signup:${contentId}`, [slots[0]]));
  isEphemeral(await handleSignup(deps, select(`signup:${contentId}`, [slots[0]])), "already hold");
  assert.deepEqual(await holders(sql, contentId), ["u1", null]);
});

const press = (customId: string, over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1",
  member: { user: { id: "u1" }, roles: [] }, data: { custom_id: customId, component_type: 2 }, ...over,
});

test("the Leave button removes a signed-up member and updates the shared roster", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleSignup(deps, select(`signup:${contentId}`, [slots[0]]));
  const r: any = await handleLeave(deps, press(`leave:${contentId}`));
  assert.equal(r.type, 7);
  assert.ok(r.data.embeds[0].description.includes("1. Tank - Mace · open"));
  assert.equal(r.data.components[1].components[0].disabled, true);
  assert.deepEqual(await holders(sql, contentId), [null, null]);
});

test("the Leave button pressed by someone not signed up only tells them so", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleSignup(deps, select(`signup:${contentId}`, [slots[0]], { member: { user: { id: "u2" }, roles: [] } }));
  isEphemeral(await handleLeave(deps, press(`leave:${contentId}`)), "not signed up");
  assert.deepEqual(await holders(sql, contentId), ["u2", null]);
});

test("the Leave button works on locked content, is refused when cancelled, guild-checked and validated", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleSignup(deps, select(`signup:${contentId}`, [slots[0]]));
  isEphemeral(await handleLeave(deps, press(`leave:${contentId}`, { guild_id: "g2" })));
  for (const bad of ["leave:", "leave:nope", `signup:${contentId}`, `leave:${contentId}:x`]) isEphemeral(await handleLeave(deps, press(bad)));
  isEphemeral(await handleLeave(deps, press(`leave:${contentId}`, { member: undefined })));
  assert.deepEqual(await holders(sql, contentId), ["u1", null]);
  await sql`update content set status = 'locked' where id = ${contentId}`;
  assert.equal(((await handleLeave(deps, press(`leave:${contentId}`))) as any).type, 7);
  await sql`update content set status = 'cancelled' where id = ${contentId}`;
  isEphemeral(await handleLeave(deps, press(`leave:${contentId}`)));
});

test("picking Leave removes the signed-up member and updates the roster", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleSignup(deps, select(`signup:${contentId}`, [slots[0]]));
  const r: any = await handleSignup(deps, select(`signup:${contentId}`, ["leave"]));
  assert.equal(r.type, 7);
  assert.ok(r.data.embeds[0].description.includes("1. Tank - Mace · open"));
  assert.ok(!menu(r).options.some((o: any) => o.value === "leave"));
  assert.deepEqual(await holders(sql, contentId), [null, null]);
});

test("picking Leave when not signed is refused privately and changes nothing", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleSignup(deps, select(`signup:${contentId}`, [slots[0]], { member: { user: { id: "u2" }, roles: [] } }));
  isEphemeral(await handleSignup(deps, select(`signup:${contentId}`, ["leave"])), "not signed up");
  assert.deepEqual(await holders(sql, contentId), ["u2", null]);
});

test("Leave still works on locked content, and is refused on cancelled content", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleSignup(deps, select(`signup:${contentId}`, [slots[0]]));
  await sql`update content set status = 'locked' where id = ${contentId}`;
  assert.equal(((await handleSignup(deps, select(`signup:${contentId}`, ["leave"]))) as any).type, 7);
  assert.deepEqual(await holders(sql, contentId), [null, null]);
  await sql`update content set status = 'cancelled' where id = ${contentId}`;
  isEphemeral(await handleSignup(deps, select(`signup:${contentId}`, ["leave"])));
});

test("taken slot is refused, no change", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleSignup(deps, select(`signup:${contentId}`, [slots[0]], { member: { user: { id: "u2" }, roles: [] } }));
  isEphemeral(await handleSignup(deps, select(`signup:${contentId}`, [slots[0]])), "taken");
  assert.deepEqual(await holders(sql, contentId), ["u2", null]);
});

test("slot of another content is refused, no change", async () => {
  const { sql, deps, contentId, otherId, otherSlots } = await setup();
  isEphemeral(await handleSignup(deps, select(`signup:${contentId}`, [otherSlots[0]])));
  assert.deepEqual(await holders(sql, contentId), [null, null]);
  assert.deepEqual(await holders(sql, otherId), [null, null]);
});

test("guild mismatch is refused for signup and for leave", async () => {
  const { sql, deps, contentId, slots } = await setup();
  isEphemeral(await handleSignup(deps, select(`signup:${contentId}`, [slots[0]], { guild_id: "g2" })));
  assert.deepEqual(await holders(sql, contentId), [null, null]);
  await handleSignup(deps, select(`signup:${contentId}`, [slots[0]]));
  isEphemeral(await handleSignup(deps, select(`signup:${contentId}`, ["leave"], { guild_id: "g2" })));
  assert.deepEqual(await holders(sql, contentId), ["u1", null]);
});

test("locked content refuses signup", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await sql`update content set status = 'locked' where id = ${contentId}`;
  isEphemeral(await handleSignup(deps, select(`signup:${contentId}`, [slots[0]])), "locked");
  assert.deepEqual(await holders(sql, contentId), [null, null]);
});

test("unknown content id is refused", async () => {
  const { deps, slots } = await setup();
  isEphemeral(await handleSignup(deps, select("signup:00000000-0000-4000-8000-000000000000", [slots[0]])));
  isEphemeral(await handleSignup(deps, select("signup:00000000-0000-4000-8000-000000000000", ["leave"])));
});

test("malformed custom ids, values and DM are refused", async () => {
  const { sql, deps, contentId, slots } = await setup();
  for (const id of ["signup:", "signup", "signup:not-a-uuid", `signup:${contentId}:x`, `leave:${contentId}`, `signup:${contentId}'; drop table content;--`]) {
    isEphemeral(await handleSignup(deps, select(id, [slots[0]])));
  }
  for (const values of [undefined, [], [5], [""], ["not-a-uuid"], "x", [slots[0], slots[1]], ["Leave"]]) {
    isEphemeral(await handleSignup(deps, select(`signup:${contentId}`, values)));
  }
  isEphemeral(await handleSignup(deps, select(`signup:${contentId}`, [slots[0]], { member: undefined })));
  isEphemeral(await handleSignup(deps, select(`signup:${contentId}`, [slots[0]], { guild_id: undefined })));
  isEphemeral(await handleSignup(deps, { ...select(`signup:${contentId}`, [slots[0]]), data: undefined }));
  assert.deepEqual(await holders(sql, contentId), [null, null]);
});

test("user id comes only from member.user.id", async () => {
  const { sql, deps, contentId, slots } = await setup();
  const i = select(`signup:${contentId}`, [slots[0]]);
  (i as any).user = { id: "evil" };
  (i.data as any).user_id = "evil";
  (i.data as any).member = { user: { id: "evil" } };
  await handleSignup(deps, i);
  assert.deepEqual(await holders(sql, contentId), ["u1", null]);
});

test("dispatch routes signup: and the legacy leave: button", async () => {
  const { sql, deps, contentId, slots } = await setup();
  const d = createDispatch(deps);
  assert.equal((await d(select(`signup:${contentId}`, [slots[0]]))).type, 7);
  assert.equal((await d(select(`signup:${contentId}`, ["leave"]))).type, 7);
  assert.deepEqual(await holders(sql, contentId), [null, null]);
  await d(select(`signup:${contentId}`, [slots[0]]));
  assert.equal((await d(press(`leave:${contentId}`))).type, 7);
});
