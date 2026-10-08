import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setMessageId } from "../../src/db/content.ts";
import { handleCreateCommand, handleCreateModal } from "../../src/handlers/create.ts";
import { handleEditCommand, handleEditModal } from "../../src/handlers/manage.ts";
import { encode, type CreateDraft } from "../../src/handlers/create-panel.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { KINDS, kindDef, kindsOf, resolveKind } from "../../src/domain/kinds.ts";
import { embedColor } from "../../src/render/theme.ts";
import { discordProblems, flatComponents, plain, textOf } from "../helpers/discordLimits.ts";

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
const channel = (id: string, type = 0) => ({ channels: { [id]: { id, type } } });
const form = (customId: string, values: Record<string, string>, over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 5, application_id: "a", token: "t", guild_id: GUILD, channel: { id: "c1", type: 0 }, member: who("boss"),
  data: { custom_id: customId, components: Object.entries(values).map(([custom_id, value]) => ({ type: 1, components: [{ type: 4, custom_id, value }] })) }, ...over,
});
const good = { title: "Ava raid", start: "2026-10-07 18:00", tier: "Weapon T7.1 - Gear T4.3", slots: "Tank\nHealer - Holy Staff", notes: "" };
const content = (r: any) => String(r.data.content ?? "");

// ---------------- build channel ----------------

test("create with a build channel carries it through the panel, and shows it in the panel text", async () => {
  const { deps } = await setup();
  const r: any = await handleCreateCommand(deps, cmd("create", [{ name: "build-channel", type: 7, value: CH }], channel(CH)));
  assert.equal(r.type, 4);
  assert.ok(r.data.content.includes(`Build channel: <#${CH}>`));
  assert.equal(r.data.components[0].components[0].custom_id, `cp:type:-:-:-:-:${CH}`);
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
});

test("a build channel must be one Discord resolved, of a type that can be mentioned; voice and made-up ones are refused", async () => {
  const { deps } = await setup();
  for (const [value, resolved] of [[CH, undefined], [CH, channel(CH, 2)], [CH, channel(CH, 4)], ["abc", channel("abc")], [CH, channel(CH2)]] as const) {
    const r: any = await handleCreateCommand(deps, cmd("create", [{ name: "build-channel", type: 7, value }], resolved));
    assert.match(content(r), /cannot be linked/, JSON.stringify([value, resolved]));
  }
  for (const type of [0, 5, 10, 11, 12, 15]) {
    const ok: any = await handleCreateCommand(deps, cmd("create", [{ name: "build-channel", type: 7, value: CH }], channel(CH, type)));
    assert.ok(ok.data.components, `type ${type} is accepted`);
  }
});

test("the longest panel, button and form ids stay within Discord's 100 characters with a build channel", async () => {
  const worst: CreateDraft = { type: "pvx", loot: true, kind: "avalonian-dungeon", presetId: "123e4567-e89b-12d3-a456-426614174000", buildChannelId: "1".repeat(20) };
  const suffix = encode(worst);
  for (const prefix of ["cp:type:", "cp:kind:", "cp:loot:", "cp:preset:", "cpgo:"]) assert.ok((prefix + suffix).length <= 100, prefix + suffix);
  assert.ok(`create:pvx:1:avalonian-dungeon:${"1".repeat(20)}`.length <= 100);
});

test("the form id carries the build channel, and the created roster shows it and stores it", async () => {
  const { deps, sql, posts } = await setup();
  const r: any = await createDispatch(deps)({
    id: "i", type: 3, application_id: "a", token: "t", guild_id: GUILD, channel: { id: "c1", type: 0 }, member: who("boss"),
    data: { custom_id: `cpgo:pvp:0:other:-:${CH}`, component_type: 2 },
  } as Interaction);
  assert.equal(r.type, 9, "no preset: the guided steps start with a form for the number of players");
  const made: any = await handleCreateModal(deps, form(`create:pvp:0:other:${CH}`, good));
  assert.match(content(made), /Created|created/);
  const [row] = await sql`select build_channel_id from content`;
  assert.equal(row!.build_channel_id, CH);
  const text = plain(textOf(posts[0]!.body));
  assert.ok(text.includes(`<#${CH}>`) && text.includes("Build"));
  assert.deepEqual(discordProblems(posts[0]!.body), []);
  assert.deepEqual(posts[0]!.body.allowed_mentions, { parse: [] });
  const bad: any = await handleCreateModal(deps, form("create:pvp:0:other:notanid", good, { channel: { id: "c2", type: 0 } }));
  assert.match(content(bad), /out of date/);
});

test("a roster without a build channel has no Build line", async () => {
  const { deps, sql, posts } = await setup();
  await handleCreateModal(deps, form("create:pvp:0:other", good));
  assert.ok(!plain(textOf(posts[0]!.body)).includes("Build"));
  assert.equal((await sql`select build_channel_id from content`)[0]!.build_channel_id, null);
});

async function withContent() {
  const s = await setup();
  const id = await createContent(s.sql, {
    guildId: GUILD, threadId: "c1", type: "pvp", title: "Raid", notes: null, startsAt: new Date("2026-12-01T18:00:00Z"), tier: "T8", hasLoot: false,
    createdBy: "boss", buildChannelId: CH, slots: [{ role: "Tank", weapon: "Mace" }],
  });
  await setMessageId(s.sql, id, "m1");
  return { ...s, id };
}
const editForm = (id: string, marker: string, extra: Partial<Interaction> = {}) =>
  form(`edit:${id}${marker}`, { title: "Raid", start: "2026-12-01 18:00", tier: "T8", slots: "Tank - Mace", notes: "" }, { channel: { id: "c1", type: 0 }, ...extra });
const buildOf = async (sql: any, id: string) => (await sql`select build_channel_id from content where id = ${id}`)[0].build_channel_id;

test("edit: a channel sets the build channel, clear-build removes it, and nothing given keeps it", async () => {
  const { deps, sql, id, edits } = await withContent();
  const set: any = await handleEditCommand(deps, cmd("edit", [{ name: "build-channel", type: 7, value: CH2 }], channel(CH2)));
  assert.equal(set.data.custom_id, `edit:${id}:k:-:b${CH2}`);
  const clear: any = await handleEditCommand(deps, cmd("edit", [{ name: "clear-build", type: 5, value: true }]));
  assert.equal(clear.data.custom_id, `edit:${id}:k:-:bx`);
  const keep: any = await handleEditCommand(deps, cmd("edit"));
  assert.equal(keep.data.custom_id, `edit:${id}:k`);
  const withKind: any = await handleEditCommand(deps, cmd("edit", [{ name: "category", type: 3, value: "zvz" }, { name: "build-channel", type: 7, value: CH2 }], channel(CH2)));
  assert.equal(withKind.data.custom_id, `edit:${id}:k:zvz:b${CH2}`);

  await handleEditModal(deps, editForm(id, ":k"));
  assert.equal(await buildOf(sql, id), CH, "kept");
  await handleEditModal(deps, editForm(id, `:k:-:b${CH2}`));
  assert.equal(await buildOf(sql, id), CH2);
  assert.ok(plain(textOf(edits.at(-1))).includes(`<#${CH2}>`));
  await handleEditModal(deps, editForm(id, ":k:-:bx"));
  assert.equal(await buildOf(sql, id), null);
  assert.ok(!plain(textOf(edits.at(-1))).includes("Build"));
});

test("edit refuses both a channel and clear-build, a bad channel, and a forged marker", async () => {
  const { deps, sql, id } = await withContent();
  const both: any = await handleEditCommand(deps, cmd("edit", [{ name: "build-channel", type: 7, value: CH2 }, { name: "clear-build", type: 5, value: true }], channel(CH2)));
  assert.match(content(both), /not both/);
  assert.match(content(await handleEditCommand(deps, cmd("edit", [{ name: "build-channel", type: 7, value: CH2 }], channel(CH2, 2)))), /cannot be linked/);
  assert.match(content(await handleEditModal(deps, editForm(id, ":k:-:bnope"))), /not valid/);
  assert.equal(await buildOf(sql, id), CH);
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

test("the create panel offers PvX, lists all its categories, and keeps a kind that fits it", async () => {
  const { d } = await setup();
  const press = (customId: string, values: unknown[]) => d({ id: "i", type: 3, application_id: "a", token: "t", guild_id: GUILD, channel: { id: "c1", type: 0 }, member: who("boss"), data: { custom_id: customId, component_type: 3, values } } as Interaction) as Promise<any>;
  const panel = await press("cp:type:-:-:-:-:-", ["pvx"]);
  const menus = panel.data.components.map((r: any) => r.components[0]);
  assert.deepEqual(menus[0].options.map((o: any) => !!o.default), [false, false, true]);
  assert.equal(menus[1].options.length, kindsOf("pvx").length);
  const kind = await press("cp:kind:pvx:-:-:-:-", ["avalonian-dungeon"]);
  assert.equal(kind.data.components.at(-1).components[0].custom_id, "cpgo:pvx:-:avalonian-dungeon:-:-");
  const swapped = await press("cp:type:pvx:-:zvz:-:-", ["pve"]);
  assert.equal(swapped.data.components.at(-1).components[0].custom_id, "cpgo:pve:-:-:-:-", "a PvP-only kind no longer fits PvE");
  const keeps = await press("cp:type:pve:-:world-boss:-:-", ["pvx"]);
  assert.equal(keeps.data.components.at(-1).components[0].custom_id, "cpgo:pvx:-:world-boss:-:-", "PvX keeps a PvE category");
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
  assert.ok(text.includes("### 🛡️ Tank · 0/1\n1. Player's choice · Open"));
  assert.ok(text.includes("2. ") && text.includes("Holy Staff"));
  assert.ok(flatComponents(posts[0]!.body).some((c) => c.type === 3));
});
