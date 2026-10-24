import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { discordProblems, flatComponents, modalProblems, rowsOf as rowsOfMsg, say, textOf } from "../helpers/discordLimits.ts";
import { testSql, resetDb } from "../helpers/db.ts";
import { handleCreateCommand, handleCreateModal } from "../../src/handlers/create.ts";
import type { Deps } from "../../src/discord/dispatch.ts";
import { createDispatch } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { DiscordApiError } from "../../src/discord/rest.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const GUILD = "g1";
const PVP = "forum-pvp";
const PVE = "forum-pve";

async function setup(failPost = false, failDelete = false, failSetId = false) {
  const sql = await testSql();
  await resetDb(sql);
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

const command = (loot?: boolean, over: Partial<Interaction> = {}, kind?: string): Interaction =>
  base({
    data: {
      name: "content",
      options: [{
        name: "create", type: 1,
        options: [
          ...(loot === undefined ? [] : [{ name: "loot-vote", type: 5, value: loot }]),
          ...(kind === undefined ? [] : [{ name: "kind", type: 3, value: kind }]),
        ],
      }],
    },
    ...over,
  });

const modal = (values: Record<string, string>, loot = "1", over: Partial<Interaction> = {}): Interaction =>
  base({
    type: 5,
    data: {
      custom_id: `create:${loot.startsWith("pve:") ? loot : `pvp:${loot}`}`,
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

const component = (customId: string, values?: unknown[], over: Partial<Interaction> = {}): Interaction =>
  base({ type: 3, data: { custom_id: customId, component_type: values ? 3 : 2, ...(values ? { values } : {}) }, ...over });
const rowsOf = (r: any) => r.data.components.map((row: any) => row.components[0]);
const selected = (select: any) => select.options.filter((o: any) => o.default).map((o: any) => o.value);

test("command without a guild, or in a place that cannot hold a roster, is an ephemeral refusal", async () => {
  const { deps } = await setup();
  const a = await handleCreateCommand(deps, command(true, { channel: { id: "t", type: 2 } }));
  assert.equal(a.type, 4);
  assert.equal((a.data as any).flags, 64);
  assert.match(content(a), /server channel/);
  const b = await handleCreateCommand(deps, command(true, { guild_id: undefined }));
  assert.match(content(b), /server channel/);
});

const cardMenus = (r: any) => flatComponents(r.data).filter((c: any) => c.type === 3);

test("the command opens the creation card: summary, Type and Category menus, Loot vote, and the buttons (ADR 0032)", async () => {
  const { deps } = await setup();
  const r: any = await handleCreateCommand(deps, command());
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64 | (1 << 15), "private, Components V2");
  assert.deepEqual(discordProblems(r.data), []);
  assert.ok(say(r).includes("Create event"));
  const [type, kind, loot] = cardMenus(r);
  assert.deepEqual(type.options.map((o: any) => o.value), ["pvp", "pve", "pvx"]);
  assert.equal(kind.disabled, true, "the category waits for the type");
  assert.deepEqual(loot.options.map((o: any) => [o.value, !!o.default]), [["0", true], ["1", false]]);
  assert.deepEqual(rowsOfMsg(r.data).at(-1)!.components.map((b: any) => b.label), ["Details", "Roles", "Build link", "Create", "Cancel"]);
  assert.ok(say(r).includes("**Roles**") && say(r).includes("instead of typing them in **Details**"), "a hint points to Roles");
  assert.deepEqual(cardMenus(r).slice(3, 6).map((m: any) => m.custom_id.split(":")[1]), ["day", "hour", "minute"], "the start as three menus");
  assert.equal(cardMenus(r).length, 6, "no preset menu while the server has none");
});

test("with saved presets the card has a Preset menu", async () => {
  const { deps, sql } = await setup();
  await sql`insert into slot_preset (guild_id, name, slots, created_by) values ('g1', 'Ava', '[{"role":"Tank","weapon":"Mace"}]'::jsonb, 'o')`;
  const r: any = await handleCreateCommand(deps, command());
  const preset = cardMenus(r)[6];
  assert.deepEqual(preset.options.map((o: any) => [o.label, o.description]), [["Ava", "1 positions"]]);
  assert.deepEqual(discordProblems(r.data), []);
});

test("it works in any forum and does not assume the type from the place", async () => {
  const { deps } = await setup();
  for (const parent of [PVP, PVE]) {
    const r: any = await handleCreateCommand(deps, command(undefined, { channel: { id: "thread-2", type: 11, parent_id: parent } }));
    assert.ok(cardMenus(r)[0].options.every((o: any) => !o.default));
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

test("modal submit from a place that cannot hold a roster creates nothing", async () => {
  const { deps, sql, posts } = await setup();
  const r = await handleCreateModal(deps, modal(good, "1", { channel: { id: "t", type: 2 } }));
  assert.match(content(r), /server channel/);
  assert.equal((await sql`select 1 from content`).length, 0);
  assert.equal(posts.length, 0);
});

test("invalid inputs respond ephemeral with the parser message and create nothing", async () => {
  const { deps, sql, posts } = await setup();
  const cases: Record<string, Record<string, string>> = {
    "gear tier": { ...good, tier: "   " },
    "80 characters": { ...good, tier: "x".repeat(81) },
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
  assert.equal((await d(command(true))).type, 4);
  assert.equal(content(await d(modal(good))), "Created");
  assert.equal(content(await d(base({ data: { name: "nope" } }))), "Not implemented yet");
  assert.equal(content(await d(base({ type: 5, data: { custom_id: "zzz:1", components: [] } }))), "Not implemented yet");
  assert.equal(content(await d(base({ type: 3, data: { custom_id: "zzz:x" } }))), "Not implemented yet");
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

test("any text channel, announcement channel, thread or forum post can hold a roster; the forum list, voice, category and DMs cannot", async () => {
  for (const type of [0, 5, 10, 11, 12]) {
    const { deps, sql, posts } = await setup();
    const ch = { id: `place-${type}`, type };
    const a: any = await handleCreateCommand(deps, command(undefined, { channel: ch }));
    assert.equal(a.type, 4, `type ${type} gets the creation card`);
    const b = await handleCreateModal(deps, modal(good, "1", { channel: ch }));
    assert.ok(!content(b).includes("server channel"));
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.channelId, `place-${type}`);
    assert.equal((await sql`select thread_id from content`)[0]!.thread_id, `place-${type}`);
  }
  for (const type of [2, 4, 13, 15]) {
    const { deps, sql, posts } = await setup();
    const ch = { id: `place-${type}`, type };
    const a = await handleCreateCommand(deps, command(true, { channel: ch }));
    assert.equal((a.data as any).flags, 64);
    assert.match(content(a), /server channel/);
    const b = await handleCreateModal(deps, modal(good, "1", { channel: ch }));
    assert.match(content(b), /server channel/);
    assert.equal((await sql`select 1 from content`).length, 0);
    assert.equal(posts.length, 0);
  }
});

test("there is still only one live content per place, and a plain channel follows the same rule", async () => {
  const { deps, sql } = await setup();
  const ch = { id: "general", type: 0 };
  await handleCreateModal(deps, modal(good, "1", { channel: ch }));
  const again = await handleCreateModal(deps, modal(good, "1", { channel: ch }));
  assert.match(content(again), /already has content/);
  assert.equal((await sql`select 1 from content`).length, 1);
  await sql`update content set status = 'cancelled'`;
  await handleCreateModal(deps, modal(good, "1", { channel: ch }));
  assert.equal((await sql`select 1 from content where status = 'open'`).length, 1);
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

test("a failing cleanup deleteContent is logged by class name only", async () => {
  const { deps, sql } = await setup(true);
  const failing = new Proxy(sql, {
    apply(t, thisArg, args) {
      if (String((args[0] as TemplateStringsArray)?.[0]).includes("delete from content")) {
        throw new TypeError("password=hunter2 leaked");
      }
      return Reflect.apply(t, thisArg, args);
    },
  });
  const lines: string[] = [];
  const orig = console.error;
  console.error = (m: unknown) => { lines.push(String(m)); };
  try {
    const r = await handleCreateModal({ ...deps, sql: failing }, modal(good));
    assert.equal((r.data as any).flags, 64);
  } finally {
    console.error = orig;
  }
  assert.ok(lines.includes(JSON.stringify({ evt: "cleanup_failed", error: "TypeError" })), lines.join("\n"));
  assert.ok(!lines.join("\n").includes("hunter2"));
});

test("command in a post that already has content replies privately with a link, no modal", async () => {
  const { deps, sql } = await setup();
  await handleCreateModal(deps, modal(good));
  const r = await handleCreateCommand(deps, command(true));
  assert.equal(r.type, 4);
  assert.equal((r.data as any).flags, 64);
  assert.match(content(r), /already has content/);
  assert.match(content(r), /discord\.com\/channels\/g1\/thread-1\/msg-1/);
  assert.match(content(r), /cancel/i);
  await sql`update content set status = 'done'`;
  assert.match(content(await handleCreateCommand(deps, command(true))), /finished|done/i);
});

test("modal submit in a taken post replies with the same message and posts nothing", async () => {
  const { deps, sql, posts } = await setup();
  await handleCreateModal(deps, modal(good));
  const r = await handleCreateModal(deps, modal({ ...good, title: "Second" }));
  assert.match(content(r), /already has content/);
  assert.equal(posts.length, 1);
  const [{ n }] = await sql`select count(*)::int as n from content`;
  assert.equal(n, 1);
});

test("after cancelling, a new content can be created in the same post", async () => {
  const { deps, sql } = await setup();
  await handleCreateModal(deps, modal(good));
  await sql`update content set status = 'cancelled'`;
  assert.equal(((await handleCreateCommand(deps, command(true))).data as any).flags & 64, 64, "the creation card opens");
  assert.equal(content(await handleCreateModal(deps, modal({ ...good, title: "Second" }))), "Created");
});

test("kind travels through the modal and is stored; no kind stores Other", async () => {
  const { deps, sql } = await setup();
  assert.equal(content(await handleCreateModal(deps, modal(good, "0:zvz"))), "Created");
  assert.equal((await sql`select kind from content`)[0]!.kind, "zvz");
  await sql`delete from content`;
  await handleCreateModal(deps, modal(good, "1"));
  assert.equal((await sql`select kind from content`)[0]!.kind, "other");
  await sql`delete from content`;
  const bad = await handleCreateModal(deps, modal(good, "0:world-boss"));
  assert.ok(content(bad).includes("PvE category"));
  assert.equal((await sql`select count(*)::int as n from content`)[0]!.n, 0);
});

test("a Discord rejection when posting is logged with its status, code and reason, and the reply stays generic", async () => {
  const { deps, sql } = await setup();
  deps.rest.createMessage = async () => { throw new DiscordApiError(400, "Discord API POST /channels/c/messages failed with status 400", 50035, "Invalid Form Body"); };
  const logged: string[] = [];
  const original = console.error;
  console.error = (line: string) => { logged.push(String(line)); };
  try {
    const r = await handleCreateModal(deps, modal(good));
    assert.ok(content(r).includes("Could not create the content"));
    assert.ok(!content(r).includes("Invalid Form Body"));
  } finally {
    console.error = original;
  }
  const entry = JSON.parse(logged.find((l) => l.includes("create_failed"))!);
  assert.deepEqual([entry.name, entry.status, entry.code, entry.detail], ["DiscordApiError", 400, 50035, "Invalid Form Body"]);
  assert.equal((await sql`select 1 from content`).length, 0);
});

test("a roster with every role posts a message Discord accepts: V2 flag, valid emoji, within the limits", async () => {
  const { deps, posts } = await setup();
  await handleCreateModal(deps, modal({ ...good, slots: "Tank - Axe\nHealer - Holy Staff\nSupport - Occult Staff\nDPS - Bow (Caller)" }));
  const body = posts[0]!.body;
  assert.equal(body.flags & (1 << 15), 1 << 15);
  assert.deepEqual(discordProblems(body), []);
  const menu = flatComponents(body).find((c) => c.type === 3)!;
  assert.equal(menu.options.length, 5, "four positions and Fill");
  assert.ok(menu.options.every((o: any) => o.emoji));
  assert.ok(textOf(body).includes("💚 Healer"));
  assert.ok(textOf(body).includes("📯 Caller"));
});

// ---- The bot's install and permissions are checked before anything is saved ----
const VIEW = 1n << 10n, SEND = 1n << 11n, SEND_T = 1n << 38n;

test("a bot added only to an account, not the server, is told so, and nothing is saved or posted", async () => {
  const { deps, sql, posts } = await setup();
  const owners = { authorizing_integration_owners: { "1": "u1" } };
  const a = await handleCreateCommand(deps, command(undefined, owners));
  assert.equal((a.data as any).flags, 64);
  assert.match(content(a), /not added to this server/);
  assert.match(content(await handleCreateModal(deps, modal(good, "1", owners))), /not added to this server/);
  assert.equal((await sql`select 1 from content`).length, 0);
  assert.equal(posts.length, 0);
  // a server install (key 0, alone or with a user install) is fine
  assert.ok(((await handleCreateCommand(deps, command(undefined, { authorizing_integration_owners: { "0": GUILD, "1": "u1" } }))).data as any).components);
});

test("a channel the bot cannot see or write in is explained, and one it can is not", async () => {
  const { deps, sql, posts } = await setup();
  const withPerms = (bits: bigint, channel = { id: "c1", type: 0 }) => ({ app_permissions: String(bits), channel });
  for (const bits of [0n, VIEW, SEND, SEND | SEND_T]) {
    const r = await handleCreateModal(deps, modal(good, "1", withPerms(bits)));
    assert.match(content(r), /cannot post here/, `bits ${bits}`);
  }
  // threads and forum posts need Send Messages in Threads, not plain Send Messages
  assert.match(content(await handleCreateModal(deps, modal(good, "1", withPerms(VIEW | SEND, { id: "t1", type: 11 })))), /cannot post here/);
  assert.equal((await sql`select 1 from content`).length, 0);
  assert.equal(posts.length, 0);
  const ok = await handleCreateModal(deps, modal(good, "1", withPerms(VIEW | SEND, { id: "plain", type: 0 })));
  assert.ok(!/cannot post|not added/.test(content(ok)));
  const okThread = await handleCreateModal(deps, modal(good, "1", withPerms(VIEW | SEND_T, { id: "thread", type: 11 })));
  assert.ok(!/cannot post|not added/.test(content(okThread)));
  assert.equal(posts.length, 2);
});

test("Administrator, or no permission information at all, lets creation try", async () => {
  const { deps, posts } = await setup();
  await handleCreateModal(deps, modal(good, "1", { app_permissions: "8", channel: { id: "a", type: 0 } }));
  await handleCreateModal(deps, modal(good, "1", { app_permissions: undefined, channel: { id: "b", type: 0 } }));
  await handleCreateModal(deps, modal(good, "1", { app_permissions: "garbage", channel: { id: "c", type: 0 } }));
  assert.equal(posts.length, 3);
});

test("the card starts with the start time (now plus one hour) and, in a post, its name as the title", async () => {
  const { deps, sql } = await setup();
  await handleCreateCommand(deps, command(undefined, { channel: { id: "thread-9", type: 11, parent_id: PVP, name: "Ava roam Friday" } }));
  const [d] = await sql`select title, start_text from slot_draft`;
  assert.equal(d!.title, "Ava roam Friday");
  assert.match(d!.start_text, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("the post's name is used as the title only in forum posts and threads", async () => {
  const { postTitle } = await import("../../src/handlers/create.ts");
  const at = (type: number, name?: string) => ({ channel: { id: "c", type, ...(name !== undefined ? { name } : {}) } }) as Interaction;
  assert.equal(postTitle(at(11, "  Ava roam Friday ")), "Ava roam Friday");
  assert.equal(postTitle(at(12, "Private thread")), "Private thread");
  assert.equal(postTitle(at(0, "pvp-content")), null, "an ordinary channel");
  assert.equal(postTitle(at(11)), null);
  assert.equal(postTitle(at(11, "   ")), null);
  assert.equal(Array.from(postTitle(at(11, "x".repeat(150)))!).length, 100);
});
