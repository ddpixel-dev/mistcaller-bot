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
  assert.deepEqual(labels(r), ["Edit", "Assign player", "Remove player", "Set duty", "Lock", "End", "Cancel", "Attendance", "Set weapon"]);
  assert.deepEqual(flatComponents(r.data).find((c) => c.label === "Remove player")!.emoji, { name: "👢" });
  const add = flatComponents(r.data).find((c) => c.label === "Assign player")!;
  assert.deepEqual([add.style, add.emoji], [3, { name: "✍️" }], "a green button with the owner's icon");
  assert.deepEqual(discordProblems({ ...r.data, flags: 0 }), []);
  const ids = flatComponents(r.data).filter((c) => c.type === 2).map((c) => c.custom_id);
  assert.deepEqual(ids, [`mg:e:${id}`, `fa:${id}`, `rm:${id}`, `dt:${id}`, `mg:l:${id}`, `mg:n:${id}`, `mg:c:${id}`, `mg:a:${id}`, `sw:${id}`]);
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
  assert.deepEqual(duties.options.map((o: any) => o.label), ["Caller", "Scout", "Rat", "Looter", "Catcher", "Party Healer", "Main Healer", "Clear"]);
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
  assert.deepEqual(ids, [`ed:k:${id}`, `ed:l:${id}`, `ed:s:${id}`, `mg:f:${id}`, `ed:b:${id}`, `ed:m:${id}`]);
  const kinds = flatComponents(p.data).find((c) => c.custom_id === `ed:k:${id}`)!;
  assert.ok(kinds.options.some((o: any) => o.value === "zvz") && !kinds.options.some((o: any) => o.value === "world-boss"), "the type's own categories");

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

  assert.ok(text(await d(click(`ed:k:${id}`, OWNER, ["world-boss"]))).includes("out of date"), "a PvE category on PvP content");
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

// FR-056: Lock, Unlock, End and Reopen update the panel itself, so the button flips without reopening Manage.
test("Lock turns the panel's button into Unlock in place, and Unlock turns it back", async () => {
  const { d, id } = await setup();
  const locked: any = await d(click(`mg:l:${id}`, OWNER));
  assert.equal(locked.type, 7, "the panel message is updated, not a second message sent");
  assert.ok(text(locked).includes("Roster locked"));
  assert.ok(labels(locked).includes("Unlock") && !labels(locked).includes("Lock"));
  assert.deepEqual(discordProblems({ ...locked.data, flags: 0 }), []);
  const open: any = await d(click(`mg:u:${id}`, OWNER));
  assert.equal(open.type, 7);
  assert.ok(text(open).includes("Roster unlocked"));
  assert.ok(labels(open).includes("Lock") && !labels(open).includes("Unlock"));
});

test("Reopen and a refused action also update the panel in place", async () => {
  const { d, id, sql } = await setup(new Date(START.getTime() + 60000));
  await sql`update content set status = 'done', ended_at = ${new Date(START.getTime() + 30000)}`;
  const reopened: any = await d(click(`mg:r:${id}`, OWNER));
  assert.equal(reopened.type, 7);
  assert.ok(text(reopened).includes("Content reopened") && labels(reopened).includes("Lock"));
  const again: any = await d(click(`mg:u:${id}`, OWNER));
  assert.equal(again.type, 7);
  assert.ok(text(again).includes("not locked"));
});

test("a stranger's click on a panel action still gets a private refusal, not the panel", async () => {
  const { d, id } = await setup();
  const r: any = await d(click(`mg:l:${id}`, STRANGER));
  assert.equal(r.type, 4);
  assert.ok(text(r).includes("Only the creator"));
});

// ---- FR-060: blank content has no roster, so its Manage panel and Edit form are small ----

async function blankSetup() {
  const s = await setup();
  const sql = s.sql;
  const id = await createContent(sql, {
    guildId: "g1", threadId: "tb", type: "pvp", title: "Meet", notes: "At the portal", startsAt: START, tier: "T8", hasLoot: false, createdBy: OWNER,
    now: NOW, slots: [], blank: true,
  });
  await setMessageId(sql, id, "mb");
  return { ...s, bid: id };
}

test("a blank content's Manage panel offers Edit, Lock, End and Cancel only", async () => {
  const { d, bid } = await blankSetup();
  const r: any = await d(click(`mg:${bid}`, OWNER, undefined, ROSTER));
  assert.deepEqual(labels(r), ["Edit", "Lock", "End", "Cancel"]);
  assert.deepEqual(discordProblems({ ...r.data, flags: 0 }), []);
});

test("a blank content's Edit panel has the category only, and its form has no slots field and saves without slots", async () => {
  const { d, bid, sql } = await blankSetup();
  const panel: any = await d(click(`mg:e:${bid}`, OWNER));
  const menuIds = flatComponents(panel.data).filter((c) => c.type === 3).map((c) => c.custom_id);
  assert.deepEqual(menuIds, [`ed:k:${bid}`], "no loot or sign-up menus");
  const f: any = await d(click(`mg:f:${bid}`, OWNER, undefined, { message: { id: "mb", flags: V2 }, channel: { id: "tb", type: 11 } } as any));
  assert.equal(f.type, 9);
  assert.deepEqual(f.data.components.map((r: any) => r.components[0].custom_id), ["title", "start", "tier", "notes"]);
  const saved: any = await d({
    id: "i", type: 5, application_id: "a", token: "t", guild_id: "g1", channel: { id: "tb", type: 11 }, member: who(OWNER),
    data: { custom_id: `edit:${bid}:k`, components: Object.entries({ title: "Meet later", start: "2026-12-01 19:00", tier: "T8", notes: "New place" }).map(([custom_id, value]) => ({ type: 1, components: [{ type: 4, custom_id, value }] })) },
  } as Interaction);
  assert.ok(!String(saved.data.content).includes("mistake"), String(saved.data.content));
  const [row] = await sql`select title, notes from content where id = ${bid}`;
  assert.deepEqual([row!.title, row!.notes], ["Meet later", "New place"]);
});

// ADR 0047: a CTA's roster lives in the CTA channel, so Manage and its panel are used there, not in the thread. The
// content id in the custom id is checked against the verified guild and the channels the content owns.
async function ctaSetup() {
  const s = await setup();
  const cta = await createContent(s.sql, {
    guildId: "g1", threadId: "t9", rosterChannelId: "ch9", cta: true, type: "pvp", title: "Castle", notes: null, startsAt: START,
    tier: "T8", hasLoot: false, createdBy: OWNER, now: NOW, slots: [{ role: "Tank", weapon: "Mace" }],
  });
  await setMessageId(s.sql, cta, "t9");
  return { ...s, cta };
}
const inCta = { channel: { id: "ch9", type: 0 } };

test("a CTA: Manage and its panel actions work from the CTA channel", async () => {
  const { d, cta, edits } = await ctaSetup();
  const r: any = await d(click(`mg:${cta}`, OWNER, undefined, { ...ROSTER, message: { id: "t9", flags: V2 }, ...inCta }));
  assert.equal(r.type, 4);
  assert.ok(text(r).includes("Manage this content"));
  const locked: any = await d(click(`mg:l:${cta}`, OWNER, undefined, { ...PANEL, ...inCta }));
  assert.equal(locked.type, 7, "the panel is updated in place");
  assert.ok(text(locked).includes("Roster locked"));
  assert.ok(edits.length > 0, "the roster was refreshed");
  const form: any = await d(click(`mg:f:${cta}`, OWNER, undefined, { ...PANEL, ...inCta }));
  assert.ok(text(form).includes("Only open content"), "the edit form found the CTA (and refuses because it is locked)");
});

test("a CTA panel action is refused for another guild, a channel the content does not own, or a malformed id", async () => {
  const { d, cta } = await ctaSetup();
  const other: any = await d(click(`mg:l:${cta}`, OWNER, undefined, { ...PANEL, ...inCta, guild_id: "g2" }));
  assert.ok(!text(other).includes("Roster locked"), "another guild's content id");
  assert.ok(text(await d(click(`mg:l:${cta}`, OWNER, undefined, { ...PANEL, channel: { id: "elsewhere", type: 0 } }))).includes("out of date"), "a channel that is neither");
  assert.ok(text(await d(click(`mg:l:${cta}`, OWNER, undefined, PANEL))).includes("out of date"), "another content's post");
  assert.ok(text(await d(click(`mg:l:${cta.slice(0, -1)}`, OWNER, undefined, { ...PANEL, ...inCta }))).includes("out of date"), "a malformed id");
  const view = await getRosterView(await testSql(), cta, NOW);
  assert.equal(view?.status, "open");
});

// FR-074: Massing at, for every kind of content, from the Edit panel.
test("Edit → Massing at opens a one-field form; text sets it and refreshes the roster, an empty field removes it; only managers", async () => {
  const { d, id, sql, edits } = await setup();
  const form: any = await d(click(`ed:m:${id}`, OWNER));
  assert.equal(form.type, 9);
  assert.equal(form.data.custom_id, `edm:${id}`);
  assert.equal(form.data.components[0].components[0].max_length, 100);
  const submit = (value: string, user = OWNER): Interaction => ({
    id: "i", type: 5, application_id: "a", token: "t", guild_id: "g1", channel: { id: "t1", type: 11 }, member: who(user),
    data: { custom_id: `edm:${id}`, components: [{ type: 1, components: [{ type: 4, custom_id: "massing", value }] }] },
  } as Interaction);
  assert.ok(text(await d(submit("Caerleon bank", STRANGER))).includes("Only the creator"));
  assert.equal((await sql`select massing_at from content`)[0]!.massing_at, null);
  assert.ok(text(await d(submit("Caerleon bank"))).includes("Massing at is set"));
  assert.equal((await sql`select massing_at from content`)[0]!.massing_at, "Caerleon bank");
  assert.ok(JSON.stringify(edits.at(-1)).includes("Massing at") && JSON.stringify(edits.at(-1)).includes("Caerleon bank"), "the roster shows it");
  const again: any = await d(click(`ed:m:${id}`, OWNER));
  assert.equal(again.data.components[0].components[0].value, "Caerleon bank", "prefilled");
  assert.ok(text(await d(submit("x".repeat(101)))).includes("at most 100"));
  assert.ok(text(await d(submit(""))).includes("Massing at is removed"));
  assert.equal((await sql`select massing_at from content`)[0]!.massing_at, null);
});
