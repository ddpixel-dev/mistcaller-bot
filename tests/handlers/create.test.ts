import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { handleCreateCommand, handleCreateModal } from "../../src/handlers/create.ts";
import type { Deps } from "../../src/discord/dispatch.ts";
import { createDispatch } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const GUILD = "g1";
const PVP = "forum-pvp";
const PVE = "forum-pve";

async function setup(failPost = false, failDelete = false, failSetId = false) {
  const sql = await testSql();
  await resetDb(sql);
  await sql`insert into guild_settings (guild_id, pvp_forum_id, pve_forum_id) values (${GUILD}, ${PVP}, ${PVE})`;
  const posts: { channelId: string; body: any }[] = [];
  const deletes: { channelId: string; messageId: string }[] = [];
  const rest: Rest = {
    async createMessage(channelId, body) {
      if (failPost) throw new Error("Bot SECRET-TOKEN exploded");
      posts.push({ channelId, body });
      return { id: "msg-1" };
    },
    async editMessage() {},
    async deleteMessage(channelId, messageId) {
      deletes.push({ channelId, messageId });
      if (failDelete) throw new Error("Bot SECRET-TOKEN delete exploded");
    },
  };
  const guarded = failSetId
    ? new Proxy(sql, {
        apply(t, thisArg, args) {
          if (String((args[0] as TemplateStringsArray)?.[0]).includes("set message_id")) throw new Error("db down");
          return Reflect.apply(t, thisArg, args);
        },
      })
    : sql;
  const deps: Deps = { sql: guarded, rest, now: () => NOW };
  return { sql, deps, posts, deletes };
}
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

const base = (over: Partial<Interaction> = {}): Interaction => ({
  id: "i1", type: 2, application_id: "app", token: "tok",
  guild_id: GUILD, channel_id: "thread-1",
  channel: { id: "thread-1", type: 11, parent_id: PVP },
  member: { user: { id: "u1" }, roles: [] },
  ...over,
});

const command = (loot?: boolean, over: Partial<Interaction> = {}): Interaction =>
  base({
    data: {
      name: "content",
      options: [{ name: "create", type: 1, options: loot === undefined ? [] : [{ name: "loot", type: 5, value: loot }] }],
    },
    ...over,
  });

const modal = (values: Record<string, string>, loot = "1", over: Partial<Interaction> = {}): Interaction =>
  base({
    type: 5,
    data: {
      custom_id: `create:${loot}`,
      components: Object.entries(values).map(([custom_id, value]) => ({
        type: 1, components: [{ type: 4, custom_id, value }],
      })),
    },
    ...over,
  });

const good = {
  title: "Ava raid", start: "2026-10-07 18:00", tier: "T5.3-T7.0",
  slots: "Tank - Axe\nHealer - Fallen\nDPS - Bow", notes: "bring food",
};

const content = (r: any) => (r.data as any).content as string;

test("command outside a configured forum or without guild is an ephemeral forum reply", async () => {
  const { deps } = await setup();
  const a = await handleCreateCommand(deps, command(true, { channel: { id: "t", type: 11, parent_id: "other" } }));
  assert.equal(a.type, 4);
  assert.equal((a.data as any).flags, 64);
  assert.match(content(a), /forum/);
  const b = await handleCreateCommand(deps, command(true, { guild_id: undefined }));
  assert.match(content(b), /forum/);
});

test("command in the PvP forum returns the modal with five inputs", async () => {
  const { deps } = await setup();
  for (const [loot, id] of [[true, "create:1"], [false, "create:0"], [undefined, "create:0"]] as const) {
    const r = await handleCreateCommand(deps, command(loot));
    assert.equal(r.type, 9);
    const d = r.data as any;
    assert.equal(d.custom_id, id);
    const inputs = d.components.map((row: any) => row.components[0]);
    assert.deepEqual(inputs.map((x: any) => x.custom_id), ["title", "start", "tier", "slots", "notes"]);
    assert.equal(inputs[1].placeholder, "2026-10-07 18:00");
    assert.equal(inputs[2].placeholder, "T5.3 or T5.3-T7.0");
    assert.equal(inputs[3].style, 2);
    assert.equal(inputs[3].placeholder, "Tank - Axe");
    assert.equal(inputs[4].required, false);
    assert.deepEqual(inputs.map((x: any) => x.max_length), [100, 20, 30, 1000, 500]);
  }
});

test("valid modal submit creates content, posts once, stores message id", async () => {
  const { deps, sql, posts } = await setup();
  const r = await handleCreateModal(deps, modal(good));
  assert.equal(r.type, 4);
  assert.equal((r.data as any).flags, 64);
  assert.equal(content(r), "Created");
  const rows = await sql`select * from content`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.type, "pvp");
  assert.equal(rows[0]!.created_by, "u1");
  assert.equal(rows[0]!.has_loot, true);
  assert.equal(rows[0]!.message_id, "msg-1");
  const slots = await sql`select role, weapon from slot order by position`;
  assert.deepEqual(slots.map((s) => `${s.role}/${s.weapon}`), ["Tank/Axe", "Healer/Fallen", "DPS/Bow"]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.channelId, "thread-1");
  assert.deepEqual(posts[0]!.body.allowed_mentions, { parse: [] });
});

test("loot flag 0 stores has_loot false; missing notes ok", async () => {
  const { deps, sql } = await setup();
  const { notes: _n, ...noNotes } = good;
  await handleCreateModal(deps, modal(noNotes, "0"));
  const rows = await sql`select has_loot, notes from content`;
  assert.equal(rows[0]!.has_loot, false);
  assert.equal(rows[0]!.notes, null);
});

test("modal submit from a non-forum channel creates nothing", async () => {
  const { deps, sql, posts } = await setup();
  const r = await handleCreateModal(deps, modal(good, "1", { channel: { id: "t", type: 11, parent_id: "other" } }));
  assert.match(content(r), /forum/);
  assert.equal((await sql`select 1 from content`).length, 0);
  assert.equal(posts.length, 0);
});

test("invalid inputs respond ephemeral with the parser message and create nothing", async () => {
  const { deps, sql, posts } = await setup();
  const cases: Record<string, Record<string, string>> = {
    "tier": { ...good, tier: "T9.9" },
    "not a real": { ...good, start: "2026-02-30 18:00" },
    "not in the future": { ...good, start: "2026-10-01 18:00" },
    "Too many slots": { ...good, slots: Array.from({ length: 21 }, () => "Tank - Axe").join("\n") },
    "too long": { ...good, title: "x".repeat(101) },
  };
  for (const [needle, values] of Object.entries(cases)) {
    const r = await handleCreateModal(deps, modal(values));
    assert.equal((r.data as any).flags, 64, needle);
    assert.match(content(r), new RegExp(needle), needle);
  }
  assert.equal((await sql`select 1 from content`).length, 0);
  assert.equal(posts.length, 0);
});

test("createMessage failure deletes the row and replies with a generic error", async () => {
  const { deps, sql } = await setup(true);
  const r = await handleCreateModal(deps, modal(good));
  assert.equal((r.data as any).flags, 64);
  assert.ok(!content(r).includes("SECRET"));
  assert.ok(!content(r).includes("exploded"));
  assert.equal((await sql`select 1 from content`).length, 0);
});

test("dispatch routes command and modal; unknown things are not implemented", async () => {
  const { deps } = await setup();
  const d = createDispatch(deps);
  assert.equal((await d(command(true))).type, 9);
  assert.equal(content(await d(modal(good))), "Created");
  assert.equal(content(await d(base({ data: { name: "nope" } }))), "Not implemented yet");
  assert.equal(content(await d(base({ type: 5, data: { custom_id: "zzz:1", components: [] } }))), "Not implemented yet");
  assert.equal(content(await d(base({ type: 3, data: { custom_id: "vote:x" } }))), "Not implemented yet");
});

test("setMessageId failure removes the row and the posted message", async () => {
  const { deps, sql, deletes } = await setup(false, false, true);
  const r = await handleCreateModal(deps, modal(good));
  assert.equal((r.data as any).flags, 64);
  assert.equal(content(r), "Could not create the content right now. Nothing was saved, please try again.");
  assert.equal((await sql`select 1 from content`).length, 0);
  assert.deepEqual(deletes, [{ channelId: "thread-1", messageId: "msg-1" }]);
});

test("setMessageId failure with failing deleteMessage still cleans the row, no secret", async () => {
  const { deps, sql, deletes } = await setup(false, true, true);
  const r = await handleCreateModal(deps, modal(good));
  assert.equal((r.data as any).flags, 64);
  assert.ok(!content(r).includes("SECRET"));
  assert.ok(!content(r).includes("exploded"));
  assert.equal((await sql`select 1 from content`).length, 0);
  assert.equal(deletes.length, 1);
});

test("a channel that is not a thread (type != 11) is refused on command and modal", async () => {
  const { deps, sql, posts } = await setup();
  const ch = { id: "thread-1", type: 0, parent_id: PVP };
  const a = await handleCreateCommand(deps, command(true, { channel: ch }));
  assert.equal((a.data as any).flags, 64);
  assert.match(content(a), /forum/);
  const b = await handleCreateModal(deps, modal(good, "1", { channel: ch }));
  assert.equal((b.data as any).flags, 64);
  assert.match(content(b), /forum/);
  assert.equal((await sql`select 1 from content`).length, 0);
  assert.equal(posts.length, 0);
});

test("thread id comes from channel.id, not channel_id", async () => {
  const { deps, posts, sql } = await setup();
  await handleCreateModal(deps, modal(good, "1", { channel_id: "other-id" }));
  assert.equal(posts[0]!.channelId, "thread-1");
  assert.equal((await sql`select thread_id from content`)[0]!.thread_id, "thread-1");
});

test("modal without member is an ephemeral error and creates nothing", async () => {
  const { deps, sql } = await setup();
  const r = await handleCreateModal(deps, modal(good, "1", { member: undefined }));
  assert.equal((r.data as any).flags, 64);
  assert.equal((await sql`select 1 from content`).length, 0);
});

test("malformed modal data does not crash", async () => {
  const { deps, sql } = await setup();
  const odd = base({
    type: 5,
    data: { custom_id: "create:1", components: [{ type: 1, components: [{ type: 4, custom_id: "title", value: 42 }] }] },
  });
  const a = await handleCreateModal(deps, odd);
  assert.equal((a.data as any).flags, 64);
  const b = await handleCreateModal(deps, base({ type: 5, data: undefined }));
  assert.equal((b.data as any).flags, 64);
  assert.equal((await sql`select 1 from content`).length, 0);
});

test("unknown interaction type is not implemented", async () => {
  const { deps } = await setup();
  const r = await createDispatch(deps)(base({ type: 99 }));
  assert.equal((r.data as any).flags, 64);
  assert.equal(content(r), "Not implemented yet");
});
