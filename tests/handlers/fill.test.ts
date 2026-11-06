import { WAITING } from "../helpers/fills.ts";
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
const text = (r: any) => String(r.data.content ?? "");
const rosterText = (body: any) => plain(textOf(body));

test("choosing Fill opens a private panel with Any, the roles and the positions", async () => {
  const { d, id, slots } = await setup();
  const r: any = await d(click(`join:${id}`, A, ["fill"]));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  const menu = flatComponents(r.data).find((c) => c.custom_id === `fp:${id}`)!;
  assert.equal(menu.min_values, 1);
  assert.equal(menu.max_values, menu.options.length);
  assert.deepEqual(menu.options.slice(0, 4).map((o: any) => o.value), ["any", "r:Tank", "r:Healer", "r:DPS"]);
  assert.ok(menu.options.some((o: any) => o.value === `s:${slots[1]}` && o.label === "2. Healer"));
  assert.ok(menu.options.length <= 25);
  assert.deepEqual(discordProblems({ ...r.data, flags: 0 }), []);
  assert.equal((await getRosterView(await testSql(), id, NOW))!.fills!.length, 0, "opening the panel signs nobody up");
});

test("submitting Any seats the player at once, healers first, refreshes the roster and tells the post where they landed", async () => {
  const { d, id, sql, edits, posts } = await setup();
  const r: any = await d(click(`fp:${id}`, A, ["any"]));
  assert.equal(r.type, 7);
  assert.ok(r.data.content.includes("position 2") && r.data.content.includes("Healer"));
  assert.ok(r.data.content.includes("Pick your weapon"), "the healer position has no weapon yet");
  assert.deepEqual(r.data.components, []);
  assert.equal((await getRosterView(sql, id, NOW))!.slots[1]!.userId, A);
  assert.ok(edits.length > 0, "the roster message was refreshed");
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.body.content, `🔁 <@${A}> joined as fill (Any) and was seated in position 2 · Healer.`);
  assert.deepEqual(posts[0]!.body.allowed_mentions, { users: [A] }, "only the player is pinged");
});

test("choosing roles and positions seats in the matching one; with no match the player waits and the roster says what they asked for", async () => {
  const { d, id, sql, slots, edits, posts } = await setup();
  const dps: any = await d(click(`fp:${id}`, A, ["r:DPS", "r:Tank"]));
  assert.ok(dps.data.content.includes("position 1"), "Tank is the lowest of the chosen roles' positions");
  assert.equal(posts[0]!.body.content, `🔁 <@${A}> joined as fill (DPS, Tank) and was seated in position 1 · Tank - Mace.`);
  const none: any = await d(click(`fp:${id}`, B, ["r:Scout", `s:${slots[0]}`]));
  assert.equal(none.type, 7);
  assert.ok(none.data.content.includes("waiting as a fill (Scout, #1)"), none.data.content);
  assert.equal(posts.length, 1, "nothing is posted until the player is seated");
  const v = (await getRosterView(sql, id, NOW))!;
  assert.deepEqual(v.fills, [B]);
  assert.ok(rosterText(edits.at(-1)).includes(`🔁 **Fill (1):** <@${B}> (Scout, \\#1)`));
});

test("a waiting fill is seated and announced when their position frees up; the same choices twice change nothing", async () => {
  const { d, id, sql, slots, posts } = await setup();
  await claimSlot(sql, { contentId: id, slotId: slots[0]!, userId: A, guildId: "g1", now: NOW });
  await d(click(`fp:${id}`, B, [`s:${slots[0]}`]));
  assert.ok(text(await d(click(`fp:${id}`, B, [`s:${slots[0]}`]))).includes("already waiting"));
  await d(click(`leave:${id}`, A));
  assert.equal((await getRosterView(sql, id, NOW))!.slots[0]!.userId, B);
  assert.equal(posts.at(-1)!.body.content.includes(`🔁 <@${B}> joined as fill (\\#1) and was seated in position 1 · Tank - Mace.`), true, posts.at(-1)!.body.content);
});

test("the waitlist menu offers Fill again, and a waiting player can choose it", async () => {
  const { d, id, slots, sql } = await setup();
  for (const [n, s] of slots.entries()) await claimSlot(sql, { contentId: id, slotId: s, userId: [A, B, C, STRANGER][n]!, guildId: "g1", now: NOW });
  const full = await getRosterView(sql, id, NOW);
  const { renderRosterMessage } = await import("../../src/render/roster.ts");
  const wait = flatComponents(renderRosterMessage(full!)).find((c) => String(c.custom_id).startsWith("wait:"))!;
  assert.equal(wait.options[0].value, "~fill");
  const r: any = await d(click(`wait:${id}`, ADMIN, ["~fill"]));
  assert.equal(r.type, 4);
  assert.ok(flatComponents(r.data).some((c) => c.custom_id === `fp:${id}`));
});

test("the fill menu refuses forged values and out-of-date panels", async () => {
  const { d, id } = await setup();
  for (const values of [[], ["nope"], ["s:not-a-uuid"], ["r:" + "x".repeat(101)]]) {
    assert.ok(text(await d(click(`fp:${id}`, A, values))).includes("out of date"), JSON.stringify(values));
  }
  assert.ok(text(await d(click(`fp:nope`, A, ["any"]))).includes("out of date"));
  assert.ok(text(await d(click(`fp:00000000-0000-0000-0000-000000000000`, A, ["any"]))).includes("no longer exists"));
});

test("joining a slot without a weapon answers with a private weapon picker, after the roster is updated", async () => {
  const { d, id, slots, edits } = await setup();
  const r: any = await d(click(`join:${id}`, A, [slots[1]!]));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.equal(edits.length, 1);
  assert.ok(rosterText(edits[0]).includes(`Player's choice`) || rosterText(edits[0]).includes(`<@${A}>`));
  assert.ok(rosterText(edits[0]).includes(` - <@${A}>`));
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
  await joinFill(sql, { contentId: id, userId: C, guildId: "g1", now: NOW, pref: WAITING });
  const labels = (r: any) => flatComponents(r.data).filter((c) => c.type === 2).map((c) => c.label);
  assert.ok(labels(await d(me(A))).includes("Change weapon"));
  assert.ok(!labels(await d(me(B))).includes("Change weapon"));
  const fill: any = await d(me(C));
  assert.ok(fill.data.content.includes("waiting as a fill (Nobody)"));
  assert.equal(flatComponents(fill.data).find((c) => c.label === "Leave")!.disabled, false);
  const opened: any = await d(click(`wp:open:${id}`, A));
  assert.equal(opened.type, 4);
  assert.equal(opened.data.flags, 64);
});

const PANEL = { message: { id: "p1", flags: 64 } }; // the private Manage panel, which is never a roster
const userPick = (customId: string, actor: string, picked: string, bot = false, over: Partial<Interaction> = {}): Interaction => ({
  ...click(customId, actor, [picked], { ...PANEL, ...over }),
  data: { custom_id: customId, component_type: 5, values: [picked], resolved: { users: { [picked]: { id: picked, ...(bot ? { bot: true } : {}) } } } },
} as Interaction);

test("Add player: only the owner or an admin; fills first, then any member; then an open position; the thread is told who signed whom", async () => {
  const { d, id, sql, edits, posts } = await setup();
  await joinFill(sql, { contentId: id, userId: A, guildId: "g1", now: NOW, pref: WAITING });
  await joinFill(sql, { contentId: id, userId: B, guildId: "g1", now: NOW, pref: WAITING });
  assert.ok(text(await d(click(`fa:${id}`, STRANGER, undefined, PANEL))).includes("Only the creator"));

  const panel: any = await d(click(`fa:${id}`, OWNER, undefined, PANEL));
  assert.equal(panel.type, 4);
  assert.equal(panel.data.flags, 64);
  const [fillRow, memberRow] = panel.data.components;
  assert.equal(fillRow.components[0].custom_id, `fa:p:${id}`);
  assert.deepEqual(fillRow.components[0].options.map((o: any) => [o.label, o.value]), [["Name-2", A], ["Name-3", B]]);
  assert.equal(memberRow.components[0].type, 5, "a member picker for anyone else");
  assert.equal(memberRow.components[0].custom_id, `fa:u:${id}`);
  assert.deepEqual(discordProblems({ ...panel.data, flags: 0 }), []);

  const chosen: any = await d(click(`fa:p:${id}`, OWNER, [A], PANEL));
  assert.equal(chosen.type, 7);
  const positions = chosen.data.components.at(-1).components[0];
  assert.equal(positions.custom_id, `fa:s:${id}:${A}`);
  assert.equal(positions.options.length, 4);
  assert.equal(chosen.data.components[0].components[0].options.find((o: any) => o.value === A).default, true);

  const done: any = await d(click(`fa:s:${id}:${A}`, OWNER, [positions.options[2].value], PANEL));
  assert.equal(done.type, 7);
  assert.ok(done.data.content.includes(`<@${A}>`) && done.data.content.includes("position 3"));
  const v = (await getRosterView(sql, id, NOW))!;
  assert.equal(v.slots[2]!.userId, A);
  assert.deepEqual(v.fills, [B]);
  assert.ok(rosterText(edits.at(-1)).includes(` - <@${A}>`));
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.body.content, `📝 <@${OWNER}> signed up <@${A}> for position 3 (⚔️ DPS).`);
  assert.deepEqual(posts[0]!.body.allowed_mentions, { users: [A] }, "only the player is pinged");
});

test("Add player: anyone picked from the member picker is placed, bots are refused", async () => {
  const { d, id, sql, slots, posts } = await setup();
  await claimSlot(sql, { contentId: id, slotId: slots[0]!, userId: A, guildId: "g1", now: NOW });
  await claimSlot(sql, { contentId: id, slotId: slots[1]!, userId: B, guildId: "g1", now: NOW });
  await joinFill(sql, { contentId: id, userId: C, guildId: "g1", now: NOW, pref: WAITING });
  await joinFill(sql, { contentId: id, userId: ADMIN, guildId: "g1", now: NOW, pref: WAITING });
  assert.ok(text(await d(userPick(`fa:u:${id}`, OWNER, "200000000000000001", true))).includes("Bots"));
  const picked: any = await d(userPick(`fa:u:${id}`, OWNER, STRANGER));
  assert.equal(picked.type, 7);
  const rows = picked.data.components;
  assert.deepEqual(rows.find((r: any) => r.components[0].type === 5).components[0].default_values, [{ id: STRANGER, type: "user" }]);
  const positions = rows.at(-1).components[0];
  assert.equal(positions.custom_id, `fa:s:${id}:${STRANGER}`);
  assert.deepEqual(discordProblems({ ...picked.data, flags: 0 }), []);
  const done: any = await d(click(`fa:s:${id}:${STRANGER}`, OWNER, [slots[3]!], PANEL));
  assert.equal(done.type, 7);
  const v = (await getRosterView(sql, id, NOW))!;
  assert.equal(v.slots[3]!.userId, STRANGER);
  assert.deepEqual(v.fills, [C, ADMIN], "the fills stay; one is now a standby");
  assert.equal(posts.at(-1)!.body.content, `📝 <@${OWNER}> signed up <@${STRANGER}> for position 4 (⚔️ DPS). Pick your weapon with \`/content me\`.`, "position 4 has no weapon");
});

test("Add player moves a seated player and serves the waitlist; stale or forged clicks change nothing", async () => {
  const { d, id, sql, slots, posts } = await setup();
  await claimSlot(sql, { contentId: id, slotId: slots[0]!, userId: A, guildId: "g1", now: NOW });
  for (const [n, u] of [B, C, STRANGER].entries()) await claimSlot(sql, { contentId: id, slotId: slots[n + 1]!, userId: u, guildId: "g1", now: NOW });
  const { joinWaitlist, leaveContent } = await import("../../src/db/signup.ts");
  await joinWaitlist(sql, { contentId: id, userId: ADMIN, guildId: "g1", role: "Tank", now: NOW });
  await leaveContent(sql, { contentId: id, userId: STRANGER, guildId: "g1" });
  await d(click(`fa:s:${id}:${A}`, OWNER, [slots[3]!], PANEL));
  const v = (await getRosterView(sql, id, NOW))!;
  assert.equal(v.slots[3]!.userId, A);
  assert.equal(v.slots[0]!.userId, ADMIN, "the freed Tank goes to the first in line");
  assert.ok(posts.some((p) => p.body.content.includes(`<@${ADMIN}> a position opened`)));

  assert.ok(text(await d(click(`fa:s:${id}:${B}`, OWNER, [slots[0]!], PANEL))).includes("already taken"));
  assert.ok(text(await d(click(`fa:s:${id}:${B}`, STRANGER, [slots[0]!], PANEL))).includes("Only the creator"));
  assert.ok(text(await d(click(`fa:s:${id}:${B}`, OWNER, ["nope"], PANEL))).includes("out of date"));
  assert.ok(text(await d(click(`fa:s:${id}:abc`, OWNER, [slots[0]!], PANEL))).includes("out of date"));
  assert.ok(text(await d(click(`fa:p:${id}`, OWNER, ["abc"], PANEL))).includes("out of date"));
  assert.ok(text(await d(click("fa:nope", OWNER, undefined, PANEL))).includes("out of date"));
  const admin = who(ADMIN, ["admins"]);
  assert.equal(((await d(click(`fa:${id}`, ADMIN, undefined, { ...PANEL, member: admin }))) as any).type, 4, "an admin role may open it");
});

test("the attendance form lists a fill and a role-only holder with sensible labels", async () => {
  const { sql, id, slots } = await setup();
  const { renderAttendanceForm } = await import("../../src/render/attendance.ts");
  const { getAttendance } = await import("../../src/db/attendance.ts");
  await claimSlot(sql, { contentId: id, slotId: slots[1]!, userId: A, guildId: "g1", now: NOW });
  await claimSlot(sql, { contentId: id, slotId: slots[0]!, userId: B, guildId: "g1", now: NOW });
  await joinFill(sql, { contentId: id, userId: C, guildId: "g1", now: NOW, pref: WAITING });
  const form: any = renderAttendanceForm((await getAttendance(sql, id))!, { [A]: "Ana", [C]: "Cy" });
  const options = form.components[0].components[0].options;
  assert.deepEqual(options.map((o: any) => [o.label, o.description]), [["1. Player 1", "Tank - Mace"], ["2. Ana", "Healer"], ["🔁 Cy", "Fill"]].map(([l, dsc]) => [l === "1. Player 1" ? "1. Player 1" : l, dsc]));
  assert.deepEqual(discordProblems({ ...form, flags: 0 }), []);
});
