import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setMessageId } from "../../src/db/content.ts";
import { claimSlot } from "../../src/db/signup.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { discordProblems, flatComponents, plain, textOf } from "../helpers/discordLimits.ts";

const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 60 * 60000);
const [OWNER, A, STRANGER, ADMIN] = ["100000000000000001", "100000000000000002", "100000000000000005", "100000000000000006"];
const V2 = 1 << 15;
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup(now = NOW) {
  const sql = await testSql();
  await sql`insert into guild_admin_role (guild_id, role_id) values ('g1', 'admins')`;
  const id = await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvp", title: "Raid", notes: null, startsAt: START, tier: "T8", hasLoot: false, createdBy: OWNER, now: NOW,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }, { role: "DPS", weapon: "" }],
  });
  await setMessageId(sql, id, "m1");
  const edits: any[] = [], posts: { channel: string; body: any }[] = [];
  const rest: Rest = {
    async createMessage(channel, body) { posts.push({ channel, body }); return { id: "x" }; },
    async editMessage(_c, _m, body) { edits.push(body); },
    async deleteMessage() {},
    async memberName(_g, u) { return `Name-${u.slice(-1)}`; },
  };
  const deps: Deps = { sql, rest, now: () => now };
  return { sql, id, d: createDispatch(deps), edits, posts };
}
const who = (id: string, roles: string[] = []) => ({ user: { id }, roles });
const ROSTER = { message: { id: "m1", flags: V2 } };
const PANEL = { message: { id: "p1", flags: 64 } };
const click = (customId: string, user: string, values?: unknown[], over: Partial<Interaction> = PANEL): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1", channel: { id: "t1", type: 11 }, member: who(user),
  data: { custom_id: customId, component_type: values ? 3 : 2, ...(values ? { values } : {}) }, ...over,
});
const text = (r: any) => String(r.data.content ?? "");
const labels = (r: any) => flatComponents(r.data).filter((c) => c.type === 2).map((c) => c.label);

test("Manage opens a private panel for the owner and admins only, with every host action", async () => {
  const { d, id } = await setup();
  assert.ok(text(await d(click(`mg:${id}`, STRANGER, undefined, ROSTER))).includes("Only the creator"));
  const r: any = await d(click(`mg:${id}`, OWNER, undefined, ROSTER));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.deepEqual(labels(r), ["Edit", "Add player", "Remove player", "Set duty", "Set weapon", "Lock", "End", "Cancel", "Attendance"]);
  const add = flatComponents(r.data).find((c) => c.label === "Add player")!;
  assert.deepEqual([add.style, add.emoji], [3, { name: "➕" }], "a green button with a plus");
  assert.deepEqual(discordProblems({ ...r.data, flags: 0 }), []);
  const ids = flatComponents(r.data).filter((c) => c.type === 2).map((c) => c.custom_id);
  assert.deepEqual(ids, [`mg:e:${id}`, `fa:${id}`, `rm:${id}`, `dt:${id}`, `sw:${id}`, `mg:l:${id}`, `mg:n:${id}`, `mg:c:${id}`, `mg:a:${id}`]);
  const admin: any = await d(click(`mg:${id}`, ADMIN, undefined, { ...ROSTER, member: who(ADMIN, ["admins"]) }));
  assert.equal(admin.type, 4);
});

test("the panel offers Unlock on a locked roster, Attendance and Reopen on a finished one, and nothing when cancelled", async () => {
  const { d, id, sql } = await setup();
  await sql`update content set status = 'locked'`;
  assert.ok(labels(await d(click(`mg:${id}`, OWNER, undefined, ROSTER))).includes("Unlock"));
  await sql`update content set status = 'done'`;
  const done: any = await d(click(`mg:${id}`, OWNER, undefined, ROSTER));
  assert.deepEqual(labels(done), ["Attendance", "Reopen"]);
  assert.deepEqual(discordProblems({ ...done.data, flags: 0 }), []);
  assert.ok(text(await d(click(`mg:${id}`, STRANGER, undefined, ROSTER))).includes("Only the creator"));
  await sql`update content set status = 'cancelled'`;
  assert.ok(text(await d(click(`mg:${id}`, OWNER, undefined, ROSTER))).includes("cancelled"));
});

test("Reopen from the panel brings finished content back", async () => {
  const { d, id, sql } = await setup(new Date(START.getTime() + 60000));
  await sql`update content set status = 'done', ended_at = ${new Date(START.getTime() + 30000)}`;
  assert.ok(text(await d(click(`mg:r:${id}`, OWNER))).includes("Content reopened"));
  assert.equal((await sql`select status from content`)[0]!.status, "open");
  assert.ok(text(await d(click(`mg:r:${id}`, STRANGER))).includes("Only the creator"));
});

test("Set weapon is offered only while a position has no weapon", async () => {
  const { d, id, sql } = await setup();
  await sql`update slot set weapon = 'Bow' where weapon is null`;
  assert.ok(!labels(await d(click(`mg:${id}`, OWNER, undefined, ROSTER))).includes("Set weapon"));
  assert.ok(text(await d(click(`sw:${id}`, OWNER))).includes("Every position already has a weapon"));
});

test("each panel button runs its command: lock, unlock, edit form, cancel confirmation, end and attendance rules", async () => {
  const { d, id, sql, edits } = await setup();
  assert.ok(text(await d(click(`mg:l:${id}`, STRANGER))).includes("Only the creator"));
  assert.ok(text(await d(click(`mg:l:${id}`, OWNER))).includes("Roster locked"));
  assert.equal((await sql`select status from content`)[0]!.status, "locked");
  assert.ok(edits.length > 0, "the roster was refreshed");
  assert.ok(text(await d(click(`mg:u:${id}`, OWNER))).includes("Roster unlocked"));
  const edit: any = await d(click(`mg:f:${id}`, OWNER));
  assert.equal(edit.type, 9, "Edit details opens the form");
  assert.equal(edit.data.custom_id, `edit:${id}:k`);
  const cancel: any = await d(click(`mg:c:${id}`, OWNER));
  assert.ok(flatComponents(cancel.data).some((c) => c.custom_id === `cancelyes:${id}`));
  assert.ok(text(await d(click(`mg:n:${id}`, OWNER))).includes("not started"));
  assert.ok(text(await d(click(`mg:a:${id}`, OWNER))).includes("not started"));
  assert.equal((await sql`select status from content`)[0]!.status, "open");
});

test("End works from the panel once the content has started", async () => {
  const { d, id, sql } = await setup(new Date(START.getTime() + 60000));
  assert.ok(text(await d(click(`mg:n:${id}`, OWNER))).includes("Content ended"));
  assert.equal((await sql`select status from content`)[0]!.status, "done");
});

test("a panel for content that is no longer the post's content, or a forged id, is refused", async () => {
  const { d, id, sql } = await setup();
  assert.ok(text(await d(click("mg:l:nope", OWNER))).includes("out of date"));
  assert.ok(text(await d(click(`mg:x:${id}`, OWNER))).includes("out of date"));
  assert.ok(text(await d(click(`mg:l:${id}`, OWNER, undefined, { ...PANEL, channel: { id: "t2", type: 11 } }))).includes("out of date"));
  assert.equal((await sql`select status from content`)[0]!.status, "open");
});

test("Set duty: a position, then a duty (Catcher included) or Clear; the roster shows it", async () => {
  const { d, id, sql, edits } = await setup();
  await claimSlot(sql, { contentId: id, slotId: (await getRosterView(sql, id, NOW))!.slots[2]!.id, userId: A, guildId: "g1", now: NOW });
  assert.ok(text(await d(click(`dt:${id}`, STRANGER))).includes("Only the creator"));
  const p: any = await d(click(`dt:${id}`, OWNER));
  assert.equal(p.type, 4);
  assert.equal(p.data.flags, 64);
  const positions = p.data.components[0].components[0];
  assert.equal(positions.custom_id, `dt:p:${id}`);
  assert.deepEqual(positions.options.map((o: any) => o.value), ["1", "2", "3"]);
  assert.deepEqual(discordProblems({ ...p.data, flags: 0 }), []);

  const picked: any = await d(click(`dt:p:${id}`, OWNER, ["3"]));
  assert.equal(picked.type, 7);
  const duties = picked.data.components.at(-1).components[0];
  assert.equal(duties.custom_id, `dt:d:${id}:3`);
  assert.deepEqual(duties.options.map((o: any) => o.label), ["Caller", "Scout", "Rat", "Looter", "Catcher", "Clear"]);
  assert.deepEqual(discordProblems({ ...picked.data, flags: 0 }), []);

  const done: any = await d(click(`dt:d:${id}:3`, OWNER, ["catcher"]));
  assert.equal(done.type, 7);
  assert.ok(done.data.content.includes("Catcher") && done.data.content.includes("position 3"));
  assert.equal((await sql`select duty from slot where position = 3`)[0]!.duty, "catcher");
  assert.ok(plain(textOf(edits.at(-1))).includes(`3. ⚔️ DPS - `) && plain(textOf(edits.at(-1))).includes("🪝 Catcher"));

  await d(click(`dt:d:${id}:3`, OWNER, ["none"]));
  assert.equal((await sql`select duty from slot where position = 3`)[0]!.duty, null);
  assert.ok(text(await d(click(`dt:d:${id}:3`, OWNER, ["captain"]))).includes("out of date"));
  assert.ok(text(await d(click(`dt:d:${id}:9`, OWNER, ["caller"]))).includes("no position 9"));
  assert.ok(text(await d(click(`dt:d:${id}:3`, STRANGER, ["caller"]))).includes("Only the creator"));
});

test("Edit opens a private panel: the category and loot vote apply at once, Edit details and Build link sit under them", async () => {
  const { d, id, sql, edits } = await setup();
  assert.ok(text(await d(click(`mg:e:${id}`, STRANGER))).includes("Only the creator"));
  const p: any = await d(click(`mg:e:${id}`, OWNER));
  assert.equal(p.type, 4);
  assert.equal(p.data.flags, 64);
  assert.deepEqual(discordProblems({ ...p.data, flags: 0 }), []);
  const ids = flatComponents(p.data).map((c) => c.custom_id).filter(Boolean);
  assert.deepEqual(ids, [`ed:k:${id}`, `ed:l:${id}`, `mg:f:${id}`, `ed:b:${id}`]);
  const kinds = flatComponents(p.data).find((c) => c.custom_id === `ed:k:${id}`)!;
  assert.ok(kinds.options.some((o: any) => o.value === "zvz") && !kinds.options.some((o: any) => o.value === "mists"), "the type's own categories");

  const k: any = await d(click(`ed:k:${id}`, OWNER, ["zvz"]));
  assert.equal(k.type, 7);
  assert.ok(text(k).includes("Category set to ZvZ"));
  assert.equal((await sql`select kind from content`)[0]!.kind, "zvz");
  assert.ok(plain(textOf(edits.at(-1))).includes("PvP · ZvZ"));
  assert.equal(flatComponents(k.data).find((c) => c.custom_id === `ed:k:${id}`)!.options.find((o: any) => o.default).value, "zvz");

  const l: any = await d(click(`ed:l:${id}`, OWNER, ["1"]));
  assert.ok(text(l).includes("Loot vote on"));
  assert.equal((await sql`select has_loot from content`)[0]!.has_loot, true);
  assert.ok(flatComponents(edits.at(-1)).some((c) => String(c.custom_id).startsWith("vote:")), "the vote buttons appear");

  assert.ok(text(await d(click(`ed:k:${id}`, OWNER, ["mists"]))).includes("out of date"), "a PvE category on PvP content");
  assert.ok(text(await d(click(`ed:l:${id}`, OWNER, ["maybe"]))).includes("out of date"));
  assert.ok(text(await d(click(`ed:k:${id}`, STRANGER, ["other"]))).includes("Only the creator"));
  await sql`update content set status = 'locked'`;
  assert.ok(text(await d(click(`mg:e:${id}`, OWNER))).includes("Only open content"));
  assert.ok(text(await d(click(`ed:k:${id}`, OWNER, ["other"]))).includes("Only open content"));
  assert.equal((await sql`select kind from content`)[0]!.kind, "zvz");
});

test("Set weapon: a position without a weapon, a class, a weapon; the roster shows it and a replaced pick is told", async () => {
  const { d, id, sql, edits, posts } = await setup();
  const { WEAPONS } = await import("../../src/data/weapons.ts");
  const { weaponsOfClass } = await import("../../src/domain/weapons.ts");
  const axe = weaponsOfClass(WEAPONS, "Axe")[0]!;
  const v = (await getRosterView(sql, id, NOW))!;
  await claimSlot(sql, { contentId: id, slotId: v.slots[2]!.id, userId: A, guildId: "g1", now: NOW });
  await sql`update signup set chosen_weapon = 'Mace' where user_id = ${A}`;

  assert.ok(text(await d(click(`sw:${id}`, STRANGER))).includes("Only the creator"));
  const p: any = await d(click(`sw:${id}`, OWNER));
  assert.equal(p.data.flags, 64);
  const positions = p.data.components[0].components[0];
  assert.deepEqual(positions.options.map((o: any) => o.value), ["3"], "only positions without a weapon");
  assert.equal(positions.options[0].description, "Player's pick: Mace");
  const c: any = await d(click(`sw:p:${id}`, OWNER, ["3"]));
  assert.equal(c.data.components.at(-1).components[0].custom_id, `sw:c:${id}:3`);
  const w: any = await d(click(`sw:c:${id}:3`, OWNER, ["Axe"]));
  const menu = w.data.components.at(-1).components[0];
  assert.equal(menu.custom_id, `sw:w:${id}:3:Axe`);
  assert.deepEqual(discordProblems({ ...w.data, flags: 0 }), []);
  const done: any = await d(click(`sw:w:${id}:3:Axe`, OWNER, [axe.base]));
  assert.equal(done.type, 7);
  assert.ok(text(done).includes(axe.name));
  assert.equal((await sql`select weapon from slot where position = 3`)[0]!.weapon, axe.name);
  assert.equal((await sql`select chosen_weapon from signup where user_id = ${A}`)[0]!.chosen_weapon, null);
  assert.ok(plain(textOf(edits.at(-1))).includes(`3. ⚔️ DPS - `) && plain(textOf(edits.at(-1))).includes(axe.name));
  assert.equal(posts.length, 1);
  assert.ok(posts[0]!.body.content.includes(`<@${A}>`) && posts[0]!.body.content.includes("Mace"));
  assert.deepEqual(posts[0]!.body.allowed_mentions, { users: [A] });

  assert.ok(text(await d(click(`sw:w:${id}:3:Axe`, OWNER, [axe.base]))).includes("already has a weapon"));
  assert.ok(text(await d(click(`sw:p:${id}`, OWNER, ["1"]))).includes("out of date"), "position 1 has a weapon");
  assert.ok(text(await d(click(`sw:c:${id}:3`, OWNER, ["Moon"]))).includes("out of date"));
  assert.ok(text(await d(click(`sw:w:${id}:3:Axe`, OWNER, ["NOT_A_WEAPON"]))).includes("out of date"));
});

test("Set weapon on an empty position posts nothing", async () => {
  const { d, id, sql, posts } = await setup();
  const { WEAPONS } = await import("../../src/data/weapons.ts");
  const { weaponsOfClass } = await import("../../src/domain/weapons.ts");
  const bow = weaponsOfClass(WEAPONS, "Bow")[0]!;
  assert.equal((await d(click(`sw:w:${id}:3:Bow`, OWNER, [bow.base])) as any).type, 7);
  assert.equal((await sql`select weapon from slot where position = 3`)[0]!.weapon, bow.name);
  assert.equal(posts.length, 0);
});
