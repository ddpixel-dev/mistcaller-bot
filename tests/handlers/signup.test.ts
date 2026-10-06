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
  const other = await createContent(sql, base);
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
const leave = (customId: string, over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1",
  member: { user: { id: "u1" }, roles: [] },
  data: { custom_id: customId, component_type: 2 },
  ...over,
});
const holders = async (sql: any, id: string) => (await getRosterView(sql, id, NOW))!.slots.map((s) => s.userId);
const isEphemeral = (r: any, text?: string) => {
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  if (text) assert.ok(r.data.content.includes(text), r.data.content);
};

test("valid selection returns UPDATE_MESSAGE showing the user", async () => {
  const { sql, deps, contentId, slots } = await setup();
  const r: any = await handleSignup(deps, select(`signup:${contentId}`, [slots[0]]));
  assert.equal(r.type, 7);
  assert.ok(r.data.embeds[0].description.includes("1. Tank - Mace · <@u1>"));
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
  assert.deepEqual(await holders(sql, contentId), ["u1", null]);
});

test("moving to another slot updates the message", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleSignup(deps, select(`signup:${contentId}`, [slots[0]]));
  const r: any = await handleSignup(deps, select(`signup:${contentId}`, [slots[1]]));
  assert.equal(r.type, 7);
  assert.deepEqual(await holders(sql, contentId), [null, "u1"]);
});

test("re-selecting own slot is a no-op update", async () => {
  const { deps, contentId, slots } = await setup();
  await handleSignup(deps, select(`signup:${contentId}`, [slots[0]]));
  const r: any = await handleSignup(deps, select(`signup:${contentId}`, [slots[0]]));
  assert.equal(r.type, 7);
});

test("taken slot is refused, no change", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleSignup(deps, select(`signup:${contentId}`, [slots[0]], { member: { user: { id: "u2" }, roles: [] } }));
  const r = await handleSignup(deps, select(`signup:${contentId}`, [slots[0]]));
  isEphemeral(r, "taken");
  assert.deepEqual(await holders(sql, contentId), ["u2", null]);
});

test("slot of another content is refused, no change", async () => {
  const { sql, deps, contentId, otherId, otherSlots } = await setup();
  const r = await handleSignup(deps, select(`signup:${contentId}`, [otherSlots[0]]));
  isEphemeral(r);
  assert.deepEqual(await holders(sql, contentId), [null, null]);
  assert.deepEqual(await holders(sql, otherId), [null, null]);
});

test("guild mismatch is refused, no change", async () => {
  const { sql, deps, contentId, slots } = await setup();
  const r = await handleSignup(deps, select(`signup:${contentId}`, [slots[0]], { guild_id: "g2" }));
  isEphemeral(r);
  assert.deepEqual(await holders(sql, contentId), [null, null]);
  const l = await handleLeave(deps, leave(`leave:${contentId}`, { guild_id: "g2" }));
  isEphemeral(l);
});

test("locked content refuses signup", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await sql`update content set status = 'locked' where id = ${contentId}`;
  const r = await handleSignup(deps, select(`signup:${contentId}`, [slots[0]]));
  isEphemeral(r, "locked");
  assert.deepEqual(await holders(sql, contentId), [null, null]);
});

test("unknown content id is refused", async () => {
  const { deps, slots } = await setup();
  isEphemeral(await handleSignup(deps, select("signup:00000000-0000-4000-8000-000000000000", [slots[0]])));
  isEphemeral(await handleLeave(deps, leave("leave:00000000-0000-4000-8000-000000000000")));
});

test("malformed custom ids, values and DM are refused", async () => {
  const { sql, deps, contentId, slots } = await setup();
  for (const id of ["signup:", "signup", "signup:not-a-uuid", `signup:${contentId}:x`, `leave:${contentId}`, `signup:${contentId}'; drop table content;--`]) {
    isEphemeral(await handleSignup(deps, select(id, [slots[0]])));
  }
  for (const values of [undefined, [], [5], [""], ["not-a-uuid"], "x", [slots[0], slots[1]]]) {
    isEphemeral(await handleSignup(deps, select(`signup:${contentId}`, values)));
  }
  isEphemeral(await handleSignup(deps, select(`signup:${contentId}`, [slots[0]], { member: undefined })));
  isEphemeral(await handleSignup(deps, select(`signup:${contentId}`, [slots[0]], { guild_id: undefined })));
  isEphemeral(await handleSignup(deps, { ...select(`signup:${contentId}`, [slots[0]]), data: undefined }));
  for (const id of ["leave:", "leave:nope", `signup:${contentId}`, `leave:${contentId}:x`]) {
    isEphemeral(await handleLeave(deps, leave(id)));
  }
  isEphemeral(await handleLeave(deps, leave(`leave:${contentId}`, { member: undefined })));
  assert.deepEqual(await holders(sql, contentId), [null, null]);
});

test("Leave when signed returns UPDATE_MESSAGE with the slot open", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleSignup(deps, select(`signup:${contentId}`, [slots[0]]));
  const r: any = await handleLeave(deps, leave(`leave:${contentId}`));
  assert.equal(r.type, 7);
  assert.ok(r.data.embeds[0].description.includes("1. Tank - Mace · open"));
  assert.deepEqual(await holders(sql, contentId), [null, null]);
});

test("Leave when not signed is refused, no change", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleSignup(deps, select(`signup:${contentId}`, [slots[0]], { member: { user: { id: "u2" }, roles: [] } }));
  const r = await handleLeave(deps, leave(`leave:${contentId}`));
  isEphemeral(r);
  assert.deepEqual(await holders(sql, contentId), ["u2", null]);
});

test("Leave on cancelled content is refused (unavailable)", async () => {
  const { sql, deps, contentId } = await setup();
  await sql`update content set status = 'cancelled' where id = ${contentId}`;
  isEphemeral(await handleLeave(deps, leave(`leave:${contentId}`)));
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

test("dispatch routes signup: and leave:", async () => {
  const { sql, deps, contentId, slots } = await setup();
  const d = createDispatch(deps);
  assert.equal((await d(select(`signup:${contentId}`, [slots[0]]))).type, 7);
  assert.equal((await d(leave(`leave:${contentId}`))).type, 7);
  assert.deepEqual(await holders(sql, contentId), [null, null]);
});
