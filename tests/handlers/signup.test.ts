import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, type NewContent } from "../../src/db/content.ts";
import { OLD_LAYOUT, handleJoin, handleLeave, handleLeaveSlot, handleOldRosterControl, handleWait } from "../../src/handlers/signup.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import { IS_COMPONENTS_V2 } from "../../src/render/roster.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { discordProblems, flatComponents, plain, textOf } from "../helpers/discordLimits.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const base: NewContent = {
  guildId: "g1", threadId: "t1", type: "pvp", title: "Ganking", notes: null,
  startsAt: new Date("2026-12-01T18:00:00Z"),
  tier: "T8.0", hasLoot: false, createdBy: "u1",
  slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }, { role: "DPS", weapon: "Bow" }],
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
  return { sql, deps, d: createDispatch(deps), contentId, otherId: other, slots: v.slots.map((s) => s.id), otherSlots: ov.slots.map((s) => s.id) };
}

const v2 = { id: "m1", flags: IS_COMPONENTS_V2 };
const pickMenu = (contentId: string, values: unknown, user = "u1", over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1", message: v2,
  member: { user: { id: user }, roles: [] },
  data: { custom_id: `join:${contentId}`, component_type: 3, values }, ...over,
});
const press = (customId: string, user = "u1", over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1", message: v2,
  member: { user: { id: user }, roles: [] }, data: { custom_id: customId, component_type: 2 }, ...over,
});
const holders = async (sql: any, id: string) => (await getRosterView(sql, id, NOW))!.slots.map((s) => s.userId);
const isEphemeral = (r: any, text?: string) => {
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  if (text) assert.ok(r.data.content.includes(text), r.data.content);
};
const menuValues = (r: any) => (flatComponents(r.data).find((c) => c.type === 3)?.options.map((o: any) => o.value) ?? []).filter((v: string) => v !== "fill");

test("picking an open position signs up, updates the shared roster, and the position leaves the menu", async () => {
  const { sql, deps, contentId, slots } = await setup();
  const r: any = await handleJoin(deps, pickMenu(contentId, [slots[1]]));
  assert.equal(r.type, 7);
  assert.equal(r.data.flags & IS_COMPONENTS_V2, IS_COMPONENTS_V2);
  assert.deepEqual(discordProblems(r.data), []);
  assert.ok(plain(textOf(r.data)).includes("### 💚 Healer · 1/1\n2. Holy · Sworn: <@u1>"));
  assert.deepEqual(menuValues(r), [slots[0], slots[2]]);
  assert.deepEqual(await holders(sql, contentId), [null, "u1", null]);
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
});

test("after signing up, the shared Leave button is enabled", async () => {
  const { deps, contentId, slots } = await setup();
  const r: any = await handleJoin(deps, pickMenu(contentId, [slots[0]]));
  const leave = flatComponents(r.data).find((c) => c.custom_id === `leave:${contentId}`);
  assert.equal(leave!.disabled, false);
  assert.equal(flatComponents(r.data).filter((c) => String(c.custom_id ?? "").startsWith("leaveslot:")).length, 0);
});

test("picking another open position moves the player and frees the old one", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleJoin(deps, pickMenu(contentId, [slots[0]]));
  const r: any = await handleJoin(deps, pickMenu(contentId, [slots[2]]));
  assert.equal(r.type, 7);
  assert.deepEqual(await holders(sql, contentId), [null, null, "u1"]);
  assert.deepEqual(menuValues(r), [slots[0], slots[1]]);
});

test("a position someone else took meanwhile is refused with a clear message, no change", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleJoin(deps, pickMenu(contentId, [slots[0]], "u2"));
  isEphemeral(await handleJoin(deps, pickMenu(contentId, [slots[0]], "u1")), "just taken");
  assert.deepEqual(await holders(sql, contentId), ["u2", null, null]);
});

test("picking the position you already hold is refused privately", async () => {
  const { deps, contentId, slots } = await setup();
  await handleJoin(deps, pickMenu(contentId, [slots[0]]));
  isEphemeral(await handleJoin(deps, pickMenu(contentId, [slots[0]])), "already hold");
});

test("signing up is refused when locked, in another guild, for another content, or with bad input", async () => {
  const { sql, deps, contentId, otherId, slots, otherSlots } = await setup();
  isEphemeral(await handleJoin(deps, pickMenu(contentId, [otherSlots[0]])));
  isEphemeral(await handleJoin(deps, pickMenu(contentId, [slots[0]], "u1", { guild_id: "g2" })));
  for (const values of [undefined, [], [5], [""], ["not-a-uuid"], "x", [slots[0], slots[1]]]) {
    isEphemeral(await handleJoin(deps, pickMenu(contentId, values)));
  }
  for (const id of ["join:", "join:nope", `join:${contentId}:x`, `signup:${contentId}`]) {
    isEphemeral(await handleJoin(deps, pickMenu(contentId, [slots[0]], "u1", { data: { custom_id: id, component_type: 3, values: [slots[0]] } })));
  }
  isEphemeral(await handleJoin(deps, pickMenu(contentId, [slots[0]], "u1", { member: undefined })));
  assert.deepEqual(await holders(sql, contentId), [null, null, null]);
  assert.deepEqual(await holders(sql, otherId), [null, null, null]);
  await sql`update content set status = 'locked' where id = ${contentId}`;
  isEphemeral(await handleJoin(deps, pickMenu(contentId, [slots[0]])), "locked");
});

test("user id comes only from member.user.id", async () => {
  const { sql, deps, contentId, slots } = await setup();
  const i = pickMenu(contentId, [slots[0]]);
  (i as any).user = { id: "evil" };
  (i.data as any).user_id = "evil";
  await handleJoin(deps, i);
  assert.deepEqual(await holders(sql, contentId), ["u1", null, null]);
});

test("the Leave button on a row frees the position for the player who holds it", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleJoin(deps, pickMenu(contentId, [slots[0]]));
  const r: any = await handleLeaveSlot(deps, press(`leaveslot:${contentId}:${slots[0]}`));
  assert.equal(r.type, 7);
  assert.deepEqual(discordProblems(r.data), []);
  assert.deepEqual(await holders(sql, contentId), [null, null, null]);
  assert.deepEqual(menuValues(r), slots);
});

test("another player pressing someone's Leave button is told it is not theirs, and nothing changes", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleJoin(deps, pickMenu(contentId, [slots[0]], "u1"));
  await handleJoin(deps, pickMenu(contentId, [slots[1]], "u2"));
  isEphemeral(await handleLeaveSlot(deps, press(`leaveslot:${contentId}:${slots[0]}`, "u2")), "not your position");
  isEphemeral(await handleLeaveSlot(deps, press(`leaveslot:${contentId}:${slots[0]}`, "u3")), "not signed up");
  assert.deepEqual(await holders(sql, contentId), ["u1", "u2", null]);
});

test("a row's Leave button works on locked content and is refused when cancelled, in another guild, or malformed", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleJoin(deps, pickMenu(contentId, [slots[0]]));
  isEphemeral(await handleLeaveSlot(deps, press(`leaveslot:${contentId}:${slots[0]}`, "u1", { guild_id: "g2" })));
  for (const bad of ["leaveslot:", "leaveslot:nope:nope", `leaveslot:${contentId}`, `leaveslot:${contentId}:${slots[0]}:x`]) {
    isEphemeral(await handleLeaveSlot(deps, press(bad)));
  }
  isEphemeral(await handleLeaveSlot(deps, press(`leaveslot:${contentId}:${slots[0]}`, "u1", { member: undefined })));
  assert.deepEqual(await holders(sql, contentId), ["u1", null, null]);
  await sql`update content set status = 'locked' where id = ${contentId}`;
  assert.equal(((await handleLeaveSlot(deps, press(`leaveslot:${contentId}:${slots[0]}`))) as any).type, 7);
  await sql`update content set status = 'cancelled' where id = ${contentId}`;
  isEphemeral(await handleLeaveSlot(deps, press(`leaveslot:${contentId}:${slots[0]}`)));
});

test("the shared Leave button (big parties) removes whoever presses it if signed up, and tells others", async () => {
  const { sql, deps, contentId, slots } = await setup();
  await handleJoin(deps, pickMenu(contentId, [slots[0]], "u1"));
  isEphemeral(await handleLeave(deps, press(`leave:${contentId}`, "u2")), "not signed up");
  const r: any = await handleLeave(deps, press(`leave:${contentId}`, "u1"));
  assert.equal(r.type, 7);
  assert.deepEqual(await holders(sql, contentId), [null, null, null]);
  isEphemeral(await handleLeave(deps, press("leave:nope")));
});

test("rosters posted with the older layout are not changed; the controls explain why", async () => {
  const { sql, deps, contentId, slots } = await setup();
  const old = { id: "m0", flags: 0 };
  isEphemeral(await handleJoin(deps, pickMenu(contentId, [slots[0]], "u1", { message: old })), "older layout");
  isEphemeral(await handleLeave(deps, press(`leave:${contentId}`, "u1", { message: old })), "older layout");
  isEphemeral(await handleLeaveSlot(deps, press(`leaveslot:${contentId}:${slots[0]}`, "u1", { message: old })), "older layout");
  isEphemeral(await handleOldRosterControl(), "older layout");
  assert.equal(OLD_LAYOUT.includes("cancel it and create a new one"), true);
  assert.deepEqual(await holders(sql, contentId), [null, null, null]);
});

test("dispatch routes the new controls and the stale old ones", async () => {
  const { sql, d, contentId, slots } = await setup();
  assert.equal((await d(pickMenu(contentId, [slots[0]]))).type, 7);
  assert.equal((await d(press(`leaveslot:${contentId}:${slots[0]}`))).type, 7);
  assert.deepEqual(await holders(sql, contentId), [null, null, null]);
  isEphemeral(await d({ ...press(`pick:${contentId}:${slots[0]}`) }), "older layout");
  isEphemeral(await d({ ...pickMenu(contentId, [slots[0]]), data: { custom_id: `signup:${contentId}`, component_type: 3, values: [slots[0]] } }), "older layout");
});

test("an interaction without a message (tests, tools) is treated as a current roster", async () => {
  const { deps, contentId, slots } = await setup();
  const i = pickMenu(contentId, [slots[0]]);
  delete (i as any).message;
  assert.equal(((await handleJoin(deps, i)) as any).type, 7);
});

// waitlist (FR-007, per role)
const waitMenu = (contentId: string, role: unknown, user: string, over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1", message: v2,
  member: { user: { id: user }, roles: [] },
  data: { custom_id: `wait:${contentId}`, component_type: 3, values: [role] }, ...over,
});

async function fullHealers() {
  const ctx = await setup();
  await ctx.sql`update slot set role = 'Healer' where id = ${ctx.slots[1]}`;
  await ctx.sql`update slot set role = 'Healer', weapon = 'Fallen' where id = ${ctx.slots[2]}`;
  await handleJoin(ctx.deps, pickMenu(ctx.contentId, [ctx.slots[1]], "h1"));
  await handleJoin(ctx.deps, pickMenu(ctx.contentId, [ctx.slots[2]], "h2"));
  return ctx;
}

test("a member joins the waitlist for a full role; it shows on the roster and in the waitlist menu", async () => {
  const { deps, contentId } = await fullHealers();
  const r: any = await handleWait(deps, waitMenu(contentId, "Healer", "w1"));
  assert.equal(r.type, 7);
  assert.deepEqual(discordProblems(r.data), []);
  assert.ok(textOf(r.data).includes("🕒 **Waitlist (1):** 1. <@w1> (Healer)"));
  assert.equal(flatComponents(r.data).find((c) => c.custom_id === `leave:${contentId}`)!.disabled, false);
});

test("the waitlist is refused for a role with an open position, a seated member, a duplicate, and bad input", async () => {
  const { deps, contentId, slots } = await fullHealers();
  isEphemeral(await handleWait(deps, waitMenu(contentId, "Tank", "w1")), "just opened");
  isEphemeral(await handleWait(deps, waitMenu(contentId, "Mage", "w1")), "not on this roster");
  await handleWait(deps, waitMenu(contentId, "Healer", "w1"));
  isEphemeral(await handleWait(deps, waitMenu(contentId, "Healer", "w1")), "already waiting");
  isEphemeral(await handleWait(deps, waitMenu(contentId, "Healer", "h1")), "Leave it first");
  for (const bad of [undefined, [], [5], [""], ["a", "b"]]) {
    isEphemeral(await handleWait(deps, waitMenu(contentId, "x", "w1", { data: { custom_id: `wait:${contentId}`, component_type: 3, values: bad } })));
  }
  isEphemeral(await handleWait(deps, waitMenu(contentId, "Healer", "w1", { guild_id: "g2" })));
  isEphemeral(await handleWait(deps, waitMenu(contentId, "Healer", "w1", { message: { id: "m0", flags: 0 } })), "older layout");
  isEphemeral(await handleWait(deps, waitMenu(contentId, "Healer", "w1", { data: { custom_id: "wait:nope", component_type: 3, values: ["Healer"] } })));
  void slots;
});

test("when a healer leaves, the first healer on the waitlist is seated and announced, and a tank waiter is not", async () => {
  const posts: any[] = [];
  const { sql, deps, contentId, slots } = await fullHealers();
  deps.rest = { ...rest, async createMessage(c, b) { posts.push({ c, b }); return { id: "p" }; } };
  await handleWait(deps, waitMenu(contentId, "Healer", "w1"));
  await sql`update slot set role = 'Tank' where id = ${slots[0]}`;
  await handleJoin(deps, pickMenu(contentId, [slots[0]], "t1"));
  await handleWait(deps, waitMenu(contentId, "Tank", "w2"));
  const r: any = await handleLeave(deps, press(`leave:${contentId}`, "h1"));
  assert.equal(r.type, 7);
  assert.deepEqual(await holders(sql, contentId), ["t1", "w1", "h2"]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].c, "t1");
  assert.ok(posts[0].b.content.includes("<@w1> a position opened for you: **2. Healer - Holy**"));
  assert.deepEqual(posts[0].b.allowed_mentions, { users: ["w1"] });
  assert.ok(textOf(r.data).includes("<@w2> (Tank)"));
});

test("leaving while on the waitlist removes you from it and seats nobody", async () => {
  const { sql, deps, contentId } = await fullHealers();
  await handleWait(deps, waitMenu(contentId, "Healer", "w1"));
  const r: any = await handleLeave(deps, press(`leave:${contentId}`, "w1"));
  assert.equal(r.type, 7);
  assert.ok(!textOf(r.data).includes("Waitlist"));
  assert.equal((await sql`select count(*)::int as n from signup where user_id = 'w1'`)[0]!.n, 0);
});

test("a failed announcement does not undo the seating", async () => {
  const { sql, deps, contentId, slots } = await fullHealers();
  await handleWait(deps, waitMenu(contentId, "Healer", "w1"));
  deps.rest = { ...rest, async createMessage() { throw new Error("boom"); } };
  const r: any = await handleLeave(deps, press(`leave:${contentId}`, "h1"));
  assert.equal(r.type, 7);
  assert.deepEqual(await holders(sql, contentId), [null, "w1", "h2"]);
  void slots;
});
