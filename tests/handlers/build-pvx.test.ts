import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setMessageId } from "../../src/db/content.ts";
import { handleCreateCommand, handleCreateModal } from "../../src/handlers/create.ts";
import { handleEditModal } from "../../src/handlers/manage.ts";
import { packRef } from "../../src/domain/buildref.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { KINDS, kindDef, kindsOf, resolveKind } from "../../src/domain/kinds.ts";
import { embedColor } from "../../src/render/theme.ts";
import { cardIdOf, discordProblems, flatComponents, plain, say, textOf } from "../helpers/discordLimits.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const CH = "123456789012345678", CH2 = "223456789012345678";
const GUILD = "100000000000000001";
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup() {
  const sql = await testSql();
  const posts: { channelId: string; body: any }[] = [];
  const edits: any[] = [];
  const rest: Rest = {
    async createMessage(channelId, body) { posts.push({ channelId, body }); return { id: "msg-1" }; },
    async editMessage(_c, _m, body) { edits.push(body); },
    async deleteMessage() {},
  };
  const deps: Deps = { sql, rest, now: () => NOW };
  return { sql, deps, posts, edits, d: createDispatch(deps) };
}
const who = (id: string) => ({ user: { id }, roles: [] as string[] });
const cmd = (sub: string, options: unknown[] = [], resolved?: unknown, over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 2, application_id: "a", token: "t", guild_id: GUILD, channel_id: "c1", channel: { id: "c1", type: 0 }, member: who("boss"),
  data: { name: "content", options: [{ name: sub, type: 1, options }], ...(resolved ? { resolved } : {}) }, ...over,
});
const form = (customId: string, values: Record<string, string>, over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 5, application_id: "a", token: "t", guild_id: GUILD, channel: { id: "c1", type: 0 }, member: who("boss"),
  data: { custom_id: customId, components: Object.entries(values).map(([custom_id, value]) => ({ type: 1, components: [{ type: 4, custom_id, value }] })) }, ...over,
});
const good = { title: "Ava raid", start: "2026-10-07 18:00", tier: "Weapon T7.1 - Gear T4.3", slots: "Tank\nHealer - Holy Staff", notes: "" };
const content = (r: any) => String(r.data.content ?? "");

// ---------------- build reference ----------------

const MSG = "323456789012345678";
const link = (channelId: string, message?: string, guild = GUILD) => `https://discord.com/channels/${guild}/${channelId}${message ? `/${message}` : ""}`;
const ref = (value: string) => ({ name: "build-reference", type: 3, value });

test("create with a build reference shows it on the creation card and keeps it", async () => {
  const { deps, sql } = await setup();
  const r: any = await handleCreateCommand(deps, cmd("create", [ref(link(CH, MSG))]));
  assert.equal(r.data.flags & 64, 64, "private");
  assert.ok(say(r).includes(`[Build message](${link(CH, MSG)})`));
  assert.equal((await sql`select build_channel_id from slot_draft`)[0]!.build_channel_id, `${CH}/${MSG}`);
});

test("the card's Build link form sets, replaces and clears the link, and refuses another server's", async () => {
  const { deps, sql, d } = await setup();
  const opened: any = await handleCreateCommand(deps, cmd("create"));
  const id = cardIdOf(opened);
  const click = (cid: string): Interaction => ({ id: "i", type: 3, application_id: "a", token: "t", guild_id: GUILD, channel: { id: "c1", type: 0 }, member: who("boss"), data: { custom_id: cid, component_type: 2 } });
  const f: any = await d(click(`cc:build:${id}`));
  assert.equal(f.type, 9);
  assert.equal(f.data.custom_id, `ccb:${id}`);
  const set: any = await d(form(`ccb:${id}`, { link: link(CH) }));
  assert.equal(set.type, 7);
  assert.ok(say(set).includes(`<#${CH}>`));
  assert.equal((await d(click(`cc:build:${id}`)) as any).data.components[0].components[0].value, link(CH));
  const other: any = await d(form(`ccb:${id}`, { link: link(CH2, undefined, "999999999999999999") }));
  assert.match(say(other), /another server/);
  assert.equal((await sql`select build_channel_id from slot_draft`)[0]!.build_channel_id, CH);
  await d(form(`ccb:${id}`, { link: "" }));
  assert.equal((await sql`select build_channel_id from slot_draft`)[0]!.build_channel_id, null);
});

test("a build reference must be a link to this server; other servers, other sites and text are refused", async () => {
  const { deps } = await setup();
  for (const value of [link(CH, undefined, "999999999999999999"), "https://example.com/x", "abc", "", `https://discord.com/channels/@me/${CH}`]) {
    const r: any = await handleCreateCommand(deps, cmd("create", [ref(value)]));
    assert.match(content(r), /not a link|another server/, value);
  }
  const ok: any = await handleCreateCommand(deps, cmd("create", [ref(`<${link(CH)}>`)]));
  assert.equal(ok.data.flags & 64, 64);
  assert.ok(ok.data.components, "a link wrapped in <> is accepted");
});

test("the longest form and button ids stay within Discord's 100 characters with a message reference", async () => {
  const worstRef = `${"9".repeat(20)}/${"9".repeat(20)}`;
  assert.ok(`create:pvx:1:avalonian-dungeon:${packRef(worstRef)}`.length <= 100);
  assert.ok(`edit:123e4567-e89b-12d3-a456-426614174000:k:avalonian-dungeon:b${packRef(worstRef)}`.length <= 100);
  assert.ok("cc:details:123e4567-e89b-12d3-a456-426614174000".length <= 100);
});

test("the form id carries the build reference, and the created roster shows it and stores it", async () => {
  const { deps, sql, posts } = await setup();
  const made: any = await handleCreateModal(deps, form(`create:pvp:0:other:${packRef(`${CH}/${MSG}`)}`, good));
  assert.match(content(made), /Created|created/);
  const [row] = await sql`select build_channel_id from content`;
  assert.equal(row!.build_channel_id, `${CH}/${MSG}`);
  const text = plain(textOf(posts[0]!.body));
  assert.ok(text.includes(link(CH, MSG)) && text.includes("Build"));
  assert.deepEqual(discordProblems(posts[0]!.body), []);
  assert.deepEqual(posts[0]!.body.allowed_mentions, { parse: [] });
  const bad: any = await handleCreateModal(deps, form("create:pvp:0:other:notanid", good, { channel: { id: "c2", type: 0 } }));
  assert.match(content(bad), /out of date/);
});

test("a roster without a build reference has no Build line", async () => {
  const { deps, sql, posts } = await setup();
  await handleCreateModal(deps, form("create:pvp:0:other", good));
  assert.ok(!plain(textOf(posts[0]!.body)).includes("Build"));
  assert.equal((await sql`select build_channel_id from content`)[0]!.build_channel_id, null);
});

async function withContent() {
  const s = await setup();
  const id = await createContent(s.sql, {
    guildId: GUILD, threadId: "c1", type: "pvp", title: "Raid", notes: null, startsAt: new Date("2026-12-01T18:00:00Z"), tier: "T8", hasLoot: false,
    createdBy: "boss", buildRef: CH, slots: [{ role: "Tank", weapon: "Mace" }],
  });
  await setMessageId(s.sql, id, "m1");
  return { ...s, id };
}
const editForm = (id: string, marker: string, extra: Partial<Interaction> = {}) =>
  form(`edit:${id}${marker}`, { title: "Raid", start: "2026-12-01 18:00", tier: "T8", slots: "Tank - Mace", notes: "" }, { channel: { id: "c1", type: 0 }, ...extra });
const buildOf = async (sql: any, id: string) => (await sql`select build_channel_id from content where id = ${id}`)[0].build_channel_id;

const click = (customId: string, values?: unknown[], user = "boss"): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: GUILD, channel: { id: "c1", type: 0 }, member: who(user), message: { id: "p1", flags: 64 },
  data: { custom_id: customId, component_type: values ? 3 : 2, ...(values ? { values } : {}) },
});

test("Edit panel: Build link opens a one-field form with the current link; a link sets it and an empty field removes it", async () => {
  const { d, sql, id, edits } = await withContent();
  const opened: any = await d(click(`ed:b:${id}`));
  assert.equal(opened.type, 9);
  assert.equal(opened.data.custom_id, `edb:${id}`);
  const input = opened.data.components[0].components[0];
  assert.equal(input.value, link(CH));
  assert.equal(input.required, false);
  assert.ok(Array.from(input.label as string).length <= 45, "Discord: a form field label holds 45 characters");

  assert.match(content(await d(form(`edb:${id}`, { link: link(CH2, MSG) }))), /saved/);
  assert.equal(await buildOf(sql, id), `${CH2}/${MSG}`);
  assert.ok(plain(textOf(edits.at(-1))).includes(link(CH2, MSG)));
  assert.equal((await d(click(`ed:b:${id}`)) as any).data.components[0].components[0].value, link(CH2, MSG));
  assert.match(content(await d(form(`edb:${id}`, { link: "" }))), /removed/);
  assert.equal(await buildOf(sql, id), null);
  assert.ok(!plain(textOf(edits.at(-1))).includes("Build"));
});

test("Build link refuses a bad link, another server's link and strangers, and changes nothing", async () => {
  const { d, sql, id } = await withContent();
  assert.match(content(await d(form(`edb:${id}`, { link: "https://example.com" }))), /not a link/);
  assert.match(content(await d(form(`edb:${id}`, { link: link(CH2, undefined, "999999999999999999") }))), /another server/);
  assert.match(content(await d(form(`edb:${id}`, { link: link(CH2) }, { member: who("stranger") }))), /Only the creator/);
  assert.match(content(await d(form("edb:nope", { link: link(CH2) }))), /out of date/);
  assert.equal(await buildOf(sql, id), CH);
});

test("forms opened before 0.23.0 still carry a category and build marker, and are understood", async () => {
  const { deps, sql, id } = await withContent();
  await handleEditModal(deps, editForm(id, ":k"));
  assert.equal(await buildOf(sql, id), CH, "kept");
  await handleEditModal(deps, editForm(id, `:k:zvz:b${packRef(CH2)}`));
  assert.equal(await buildOf(sql, id), CH2);
  assert.equal((await sql`select kind from content`)[0]!.kind, "zvz");
  await handleEditModal(deps, editForm(id, ":k:-:bx"));
  assert.equal(await buildOf(sql, id), null);
  assert.match(content(await handleEditModal(deps, editForm(id, ":k:-:bnope"))), /not valid/);
});

// ---------------- PvX ----------------

test("PvX has every PvP and PvE category once, PvP first, and resolveKind accepts any of them", () => {
  const ids = kindsOf("pvx").map((k) => k.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, KINDS.filter((k) => k.type === "pvp").length + KINDS.filter((k) => k.type === "pve").length - 1);
  assert.ok(ids.indexOf("zvz") < ids.indexOf("group-dungeon"));
  assert.equal(ids.at(-1), "other");
  assert.ok(kindsOf("pvx").length <= 25);
  for (const id of ["zvz", "gank-squad", "avalonian-dungeon", "world-boss", "other"]) assert.deepEqual(resolveKind("pvx", id), { ok: true, value: id });
  assert.deepEqual(resolveKind("pvx", null), { ok: true, value: "other" });
  assert.equal(resolveKind("pvx", "nonsense").ok, false);
  assert.equal(kindDef("pvx", "other")!.color, embedColor("pvx", "open", "other"));
  assert.notEqual(embedColor("pvx", "open"), embedColor("pvp", "open"));
  assert.notEqual(embedColor("pvx", "open"), embedColor("pve", "open"));
});

test("the creation card offers PvX with every category", async () => {
  const { deps, d } = await setup();
  const opened: any = await handleCreateCommand(deps, cmd("create"));
  const id = cardIdOf(opened);
  const r: any = await d({ id: "i", type: 3, application_id: "a", token: "t", guild_id: GUILD, channel: { id: "c1", type: 0 }, member: who("boss"), data: { custom_id: `cc:type:${id}`, component_type: 3, values: ["pvx"] } } as Interaction);
  const kinds = flatComponents(r.data).filter((c: any) => c.type === 3)[1].options;
  assert.equal(kinds.length, kindsOf("pvx").length);
});

test("a PvX content is stored as pvx and shows PvX with its category in the header", async () => {
  const { deps, sql, posts } = await setup();
  const r: any = await handleCreateModal(deps, form("create:pvx:0:avalonian-dungeon", good));
  assert.match(content(r), /Created|created/);
  assert.equal((await sql`select type from content`)[0]!.type, "pvx");
  const text = plain(textOf(posts[0]!.body));
  assert.ok(text.includes("PvX · Avalonian dungeon"));
  assert.deepEqual(discordProblems(posts[0]!.body), []);
  assert.equal(posts[0]!.body.components[0].accent_color, kindDef("pvx", "avalonian-dungeon")!.color);
  assert.match(content(await handleCreateModal(deps, form("create:pvz:0:other", good, { channel: { id: "c9", type: 0 } }))), /out of date/);
  const v = (await getRosterView(sql, (await sql`select id from content`)[0]!.id, NOW))!;
  assert.equal(v.type, "pvx");
});

test("a role-only slot shows Player's choice, then the player's own weapon", async () => {
  const { deps, posts } = await setup();
  await handleCreateModal(deps, form("create:pvp:0:other", good));
  const text = plain(textOf(posts[0]!.body));
  assert.ok(text.includes("1. 🛡️ Tank - Player's choice - Open"));
  assert.ok(text.includes("2. ") && text.includes("Holy Staff"));
  assert.ok(flatComponents(posts[0]!.body).some((c) => c.type === 3));
});
