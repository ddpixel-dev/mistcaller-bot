import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setMessageId } from "../../src/db/content.ts";
import { claimSlot, joinFill } from "../../src/db/signup.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { WEAPONS } from "../../src/data/weapons.ts";
import { weaponsOfClass } from "../../src/domain/weapons.ts";
import { discordProblems, flatComponents, plain, textOf } from "../helpers/discordLimits.ts";

const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 60 * 60000);
const [OWNER, A, B, C, STRANGER, ADMIN] = ["100000000000000001", "100000000000000002", "100000000000000003", "100000000000000004", "100000000000000005", "100000000000000006"];
const V2 = 1 << 15;
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup(opts: { failEdit?: boolean } = {}) {
  const sql = await testSql();
  await sql`insert into guild_admin_role (guild_id, role_id) values ('g1', 'admins')`;
  const id = await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvp", title: "Raid", notes: null, startsAt: START, tier: "T8", hasLoot: false, createdBy: OWNER, now: NOW,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "" }, { role: "DPS", weapon: "Bow" }, { role: "DPS", weapon: "" }],
  });
  await setMessageId(sql, id, "m1");
  const view = (await getRosterView(sql, id, NOW))!;
  const slots = view.slots.map((s) => s.id);
  const edits: any[] = [], posts: { channel: string; body: any }[] = [];
  const rest: Rest = {
    async createMessage(channel, body) { posts.push({ channel, body }); return { id: "x" }; },
    async editMessage(_c, _m, body) { if (opts.failEdit) throw new Error("edit failed"); edits.push(body); },
    async deleteMessage() {},
    async memberName(_g, u) { return `Name-${u.slice(-1)}`; },
  };
  const deps: Deps = { sql, rest, now: () => NOW };
  return { sql, id, slots, deps, d: createDispatch(deps), edits, posts };
}
const who = (id: string, roles: string[] = [], permissions?: string) => ({ user: { id }, roles, ...(permissions ? { permissions } : {}) });
const click = (customId: string, user: string, values?: unknown[], over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1", channel: { id: "t1", type: 11 },
  message: { id: "m1", flags: V2 }, member: who(user),
  data: { custom_id: customId, component_type: values ? 3 : 2, ...(values ? { values } : {}) }, ...over,
});
const assignCmd = (user: string, options: unknown[], member = who(user)): Interaction => ({
  id: "i", type: 2, application_id: "a", token: "t", guild_id: "g1", channel: { id: "t1", type: 11 }, member,
  data: { name: "content", options: [{ name: "assign", type: 1, options }] },
});
const text = (r: any) => String(r.data.content ?? "");
const rosterText = (body: any) => plain(textOf(body));

test("choosing Fill in the join menu lists the member as a fill and shows the Assign fill button", async () => {
  const { d, id } = await setup();
  const r: any = await d(click(`join:${id}`, A, ["fill"]));
  assert.equal(r.type, 7);
  assert.ok(rosterText(r.data).includes(`🔁 **Fill (1):** <@${A}>`));
  const buttons = flatComponents(r.data).filter((c) => c.type === 2).map((c) => c.label);
  assert.ok(buttons.includes("Assign fill"));
  assert.equal(flatComponents(r.data).find((c) => c.custom_id === `leave:${id}`)!.disabled, false, "Leave works for a fill");
  assert.deepEqual(discordProblems(r.data), []);
  assert.ok(text(await d(click(`join:${id}`, A, ["fill"]))).includes("already listed as a fill"));
});

test("with no fills the Assign fill button is not shown, and the waitlist menu offers Fill when the roster is full", async () => {
  const { d, id, slots, sql } = await setup();
  const none: any = await d(click(`join:${id}`, A, [slots[0]!]));
  assert.ok(!flatComponents(none.data).some((c) => c.label === "Assign fill"));
  for (const [n, s] of slots.slice(1).entries()) await claimSlot(sql, { contentId: id, slotId: s, userId: [B, C, STRANGER][n]!, guildId: "g1", now: NOW });
  const r: any = await d(click(`wait:${id}`, ADMIN, ["~fill"]));
  assert.equal(r.type, 7);
  assert.ok(rosterText(r.data).includes(`<@${ADMIN}>`));
  const full = (await getRosterView(sql, id, NOW))!;
  assert.deepEqual(full.fills, [ADMIN]);
});

test("joining a slot without a weapon answers with a private weapon picker, after the roster is updated", async () => {
  const { d, id, slots, edits } = await setup();
  const r: any = await d(click(`join:${id}`, A, [slots[1]!]));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.equal(edits.length, 1);
  assert.ok(rosterText(edits[0]).includes(`Player's choice`) || rosterText(edits[0]).includes(`<@${A}>`));
  assert.ok(rosterText(edits[0]).includes(`Sworn: <@${A}>`));
  const rows = r.data.components;
  assert.equal(rows[0].components[0].custom_id, `wp:c:${id}`);
  assert.ok(rows[0].components[0].options.length > 5);
  assert.equal(rows.at(-1).components[0].label, "Skip");
  assert.deepEqual(discordProblems({ ...r.data, flags: 0 }), []);
});

test("joining a slot that has a weapon changes the roster in place, with no private message", async () => {
  const { d, id, slots, edits } = await setup();
  const r: any = await d(click(`join:${id}`, A, [slots[0]!]));
  assert.equal(r.type, 7);
  assert.equal(edits.length, 0);
});

test("if the roster cannot be edited, the join still answers with the roster itself", async () => {
  const { d, id, slots } = await setup({ failEdit: true });
  const r: any = await d(click(`join:${id}`, A, [slots[1]!]));
  assert.equal(r.type, 7);
  assert.ok(rosterText(r.data).includes(`<@${A}>`));
});

test("the picker: class, then weapon; the choice is saved, shown on the roster, and the panel closes", async () => {
  const { d, id, slots, sql, edits } = await setup();
  await d(click(`join:${id}`, A, [slots[1]!]));
  const bow = weaponsOfClass(WEAPONS, "Bow")[0]!;
  const pickedClass: any = await d(click(`wp:c:${id}`, A, ["Bow"]));
  assert.equal(pickedClass.type, 7);
  const menu = pickedClass.data.components[1].components[0];
  assert.equal(menu.custom_id, `wp:w:${id}:Bow`);
  assert.ok(menu.options.some((o: any) => o.value === bow.base) && menu.options.length <= 25);
  const done: any = await d(click(`wp:w:${id}:Bow`, A, [bow.base]));
  assert.equal(done.type, 7);
  assert.ok(done.data.content.includes(bow.name));
  assert.deepEqual(done.data.components, []);
  assert.equal((await sql`select chosen_weapon from signup where user_id = ${A}`)[0]!.chosen_weapon, bow.name);
  assert.ok(rosterText(edits.at(-1)).includes(bow.name), "the roster shows the player's weapon");
});

test("the picker refuses a made-up class or weapon, a weapon from another class, and a player without such a slot", async () => {
  const { d, id, slots, sql } = await setup();
  await d(click(`join:${id}`, A, [slots[1]!]));
  const bow = weaponsOfClass(WEAPONS, "Bow")[0]!;
  const sword = weaponsOfClass(WEAPONS, "Sword")[0]!;
  assert.ok(text(await d(click(`wp:c:${id}`, A, ["Moon"]))).includes("out of date"));
  assert.ok(text(await d(click(`wp:w:${id}:Bow`, A, ["NOT_A_WEAPON"]))).includes("out of date"));
  assert.ok(text(await d(click(`wp:w:${id}:Bow`, A, [sword.base]))).includes("out of date"));
  assert.ok(text(await d(click(`wp:w:${id}:Bow`, B, [bow.base]))).includes("not on a position without a weapon"));
  await d(click(`join:${id}`, C, [slots[0]!]));
  assert.ok(text(await d(click(`wp:w:${id}:Bow`, C, [bow.base]))).includes("already has a weapon"));
  assert.ok(text(await d(click("wp:w:nope:Bow", A, [bow.base]))).includes("out of date"));
  assert.equal((await sql`select chosen_weapon from signup where chosen_weapon is not null`).length, 0);
  const skip: any = await d(click(`wp:skip:${id}`, A));
  assert.equal(skip.type, 7);
  assert.deepEqual(skip.data.components, []);
});

test("/content me shows a fill, and offers Change weapon only to the holder of a slot without a weapon", async () => {
  const { d, id, slots, sql } = await setup();
  const me = (u: string): Interaction => ({
    id: "i", type: 2, application_id: "a", token: "t", guild_id: "g1", channel: { id: "t1", type: 11 }, member: who(u),
    data: { name: "content", options: [{ name: "me", type: 1 }] },
  });
  await claimSlot(sql, { contentId: id, slotId: slots[1]!, userId: A, guildId: "g1", now: NOW });
  await claimSlot(sql, { contentId: id, slotId: slots[0]!, userId: B, guildId: "g1", now: NOW });
  await joinFill(sql, { contentId: id, userId: C, guildId: "g1", now: NOW });
  const labels = (r: any) => flatComponents(r.data).filter((c) => c.type === 2).map((c) => c.label);
  assert.ok(labels(await d(me(A))).includes("Change weapon"));
  assert.ok(!labels(await d(me(B))).includes("Change weapon"));
  const fill: any = await d(me(C));
  assert.ok(fill.data.content.includes("signed up as a fill"));
  assert.equal(flatComponents(fill.data).find((c) => c.label === "Leave")!.disabled, false);
  const opened: any = await d(click(`wp:open:${id}`, A));
  assert.equal(opened.type, 4);
  assert.equal(opened.data.flags, 64);
});

test("Assign fill: only the owner or an admin; then a fill, then an open position; the thread is told and the roster refreshed", async () => {
  const { d, id, sql, edits, posts } = await setup();
  assert.ok(text(await d(click(`fa:${id}`, OWNER))).includes("Nobody is waiting"));
  await joinFill(sql, { contentId: id, userId: A, guildId: "g1", now: NOW });
  await joinFill(sql, { contentId: id, userId: B, guildId: "g1", now: NOW });
  assert.ok(text(await d(click(`fa:${id}`, STRANGER))).includes("Only the creator"));

  const panel: any = await d(click(`fa:${id}`, OWNER));
  assert.equal(panel.type, 4);
  assert.equal(panel.data.flags, 64);
  const picker = panel.data.components[0].components[0];
  assert.equal(picker.custom_id, `fa:p:${id}`);
  assert.deepEqual(picker.options.map((o: any) => [o.label, o.value]), [["Name-2", A], ["Name-3", B]]);

  const chosen: any = await d(click(`fa:p:${id}`, ADMIN.length ? OWNER : OWNER, [A]));
  assert.equal(chosen.type, 7);
  const positions = chosen.data.components[1].components[0];
  assert.equal(positions.custom_id, `fa:s:${id}:${A}`);
  assert.equal(positions.options.length, 4);
  assert.equal(chosen.data.components[0].components[0].options.find((o: any) => o.value === A).default, true);

  const done: any = await d(click(`fa:s:${id}:${A}`, OWNER, [positions.options[2].value]));
  assert.equal(done.type, 7);
  assert.ok(done.data.content.includes(`<@${A}>`) && done.data.content.includes("position 3"));
  const v = (await getRosterView(sql, id, NOW))!;
  assert.equal(v.slots[2]!.userId, A);
  assert.deepEqual(v.fills, [B]);
  assert.ok(rosterText(edits.at(-1)).includes(`Sworn: <@${A}>`));
  assert.equal(posts.length, 1);
  assert.ok(posts[0]!.body.content.includes("position 3") && posts[0]!.body.content.includes(`<@${A}>`));
  assert.deepEqual(posts[0]!.body.allowed_mentions, { users: [A] });
});

test("an admin role may assign, and stale or forged clicks are refused without changing anything", async () => {
  const { d, id, slots, sql } = await setup();
  await joinFill(sql, { contentId: id, userId: A, guildId: "g1", now: NOW });
  await claimSlot(sql, { contentId: id, slotId: slots[0]!, userId: C, guildId: "g1", now: NOW });
  const admin = who(ADMIN, ["admins"]);
  assert.equal(((await d(click(`fa:${id}`, ADMIN, undefined, { member: admin }))) as any).type, 4);
  assert.ok(text(await d(click(`fa:s:${id}:${A}`, OWNER, [slots[0]!]))).includes("already taken"));
  assert.ok(text(await d(click(`fa:s:${id}:${B}`, OWNER, [slots[2]!]))).includes("not waiting as a fill"), "B is not a fill");
  assert.ok(text(await d(click(`fa:p:${id}`, OWNER, [B]))).includes("not waiting as a fill"));
  assert.ok(text(await d(click(`fa:s:${id}:${A}`, STRANGER, [slots[2]!]))).includes("Only the creator"));
  assert.ok(text(await d(click(`fa:s:${id}:${A}`, OWNER, ["nope"]))).includes("out of date"));
  assert.ok(text(await d(click(`fa:s:${id}:abc`, OWNER, [slots[2]!]))).includes("out of date"));
  assert.ok(text(await d(click("fa:nope", OWNER))).includes("out of date"));
  assert.ok(text(await d(click(`fa:${id}`, OWNER, undefined, { message: { id: "m1", flags: 0 } }))).includes("older layout"));
  assert.equal((await getRosterView(sql, id, NOW))!.fills!.length, 1);
});

test("/content assign: the owner and admins place a fill; others, non-fills and bad input are refused", async () => {
  const { d, id, sql, posts } = await setup();
  await joinFill(sql, { contentId: id, userId: A, guildId: "g1", now: NOW });
  const opts = (position: unknown, member: unknown) => [{ name: "position", type: 4, value: position }, { name: "member", type: 6, value: member }];
  assert.ok(text(await d(assignCmd(STRANGER, opts(3, A)))).includes("Only the creator"));
  assert.ok(text(await d(assignCmd(OWNER, opts(99, A)))).includes("1 to 20"));
  assert.ok(text(await d(assignCmd(OWNER, opts(3, "nope")))).includes("Pick the member"));
  assert.ok(text(await d(assignCmd(OWNER, opts(3, B)))).includes("not waiting as a fill"));
  assert.ok(text(await d(assignCmd(OWNER, opts(9, A)))).includes("no such position"));
  const ok: any = await d(assignCmd(ADMIN, opts(3, A), who(ADMIN, ["admins"])));
  assert.ok(ok.data.content.includes("position 3"));
  assert.equal(ok.data.flags, 64);
  assert.equal((await getRosterView(sql, id, NOW))!.slots[2]!.userId, A);
  assert.equal(posts.length, 1);
  assert.ok(text(await d(assignCmd(OWNER, opts(3, A)))).includes("not waiting as a fill"), "nothing to assign twice");
});

test("the attendance form lists a fill and a role-only holder with sensible labels", async () => {
  const { sql, id, slots } = await setup();
  const { renderAttendanceForm } = await import("../../src/render/attendance.ts");
  const { getAttendance } = await import("../../src/db/attendance.ts");
  await claimSlot(sql, { contentId: id, slotId: slots[1]!, userId: A, guildId: "g1", now: NOW });
  await claimSlot(sql, { contentId: id, slotId: slots[0]!, userId: B, guildId: "g1", now: NOW });
  await joinFill(sql, { contentId: id, userId: C, guildId: "g1", now: NOW });
  const form: any = renderAttendanceForm((await getAttendance(sql, id))!, { [A]: "Ana", [C]: "Cy" });
  const options = form.components[0].components[0].options;
  assert.deepEqual(options.map((o: any) => [o.label, o.description]), [["1. Player 1", "Tank - Mace"], ["2. Ana", "Healer"], ["🔁 Cy", "Fill"]].map(([l, dsc]) => [l === "1. Player 1" ? "1. Player 1" : l, dsc]));
  assert.deepEqual(discordProblems({ ...form, flags: 0 }), []);
});
