import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setMessageId, type NewContent } from "../../src/db/content.ts";
import { handleCancelButton, handleCancelCommand, handleEditCommand, handleEditModal } from "../../src/handlers/manage.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const base: NewContent = {
  guildId: "g1", threadId: "t1", type: "pvp", title: "Ganking", notes: null,
  startsAt: new Date("2026-12-01T18:00:00Z"),
  tier: { min: { tier: 8, enchant: 0 }, max: null }, hasLoot: false, createdBy: "boss",
  slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }],
};

beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup() {
  const sql = await testSql();
  await sql`insert into guild_admin_role (guild_id, role_id) values ('g1', 'officer')`;
  const id = await createContent(sql, base);
  await setMessageId(sql, id, "m1");
  const edits: any[] = [];
  const posts: any[] = [];
  const rest: Rest = {
    async createMessage(channelId, body) { posts.push({ channelId, body }); return { id: "p" }; },
    async editMessage(channelId, messageId, body) { edits.push({ channelId, messageId, body }); },
    async deleteMessage() {},
  };
  const deps: Deps = { sql, rest, now: () => NOW };
  const slots = (await getRosterView(sql, id, NOW))!.slots.map((s) => s.id);
  return { sql, deps, id, edits, posts, slots };
}

const who = (userId: string, roles: string[] = [], permissions?: string) => ({ user: { id: userId }, roles, permissions });
const command = (sub: string, userId = "boss", extra: Partial<Interaction> = {}, options: unknown[] = []): Interaction => ({
  id: "i", type: 2, application_id: "a", token: "t", guild_id: "g1", channel_id: "t1",
  channel: { id: "t1", type: 11, parent_id: "fp" }, member: who(userId),
  data: { name: "content", options: [{ name: sub, type: 1, options }] }, ...extra,
});
const modal = (id: string, loot: string, values: Record<string, string>, userId = "boss"): Interaction => ({
  id: "i", type: 5, application_id: "a", token: "t", guild_id: "g1", channel_id: "t1",
  channel: { id: "t1", type: 11, parent_id: "fp" }, member: who(userId),
  data: {
    custom_id: `edit:${id}:${loot}`,
    components: Object.entries(values).map(([custom_id, value]) => ({ type: 1, components: [{ type: 4, custom_id, value }] })),
  },
});
const button = (customId: string, userId = "boss", over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1", member: who(userId),
  data: { custom_id: customId, component_type: 2 }, ...over,
});
const good = { title: "Ganking 2", start: "2026-12-02 18:00", tier: "T6.1-T8.0", slots: "Tank - Mace\nHealer - Holy\nScout - Bow", notes: "food" };
const text = (r: any) => r.data.content as string;
const isEphemeral = (r: any) => { assert.equal(r.type, 4); assert.equal(r.data.flags, 64); };

test("edit command opens a modal prefilled with the current values", async () => {
  const { deps, id } = await setup();
  const r: any = await handleEditCommand(deps, command("edit", "boss", {}, [{ name: "loot-vote", type: 5, value: true }]));
  assert.equal(r.type, 9);
  assert.equal(r.data.custom_id, `edit:${id}:1`);
  const inputs = r.data.components.map((row: any) => row.components[0]);
  assert.deepEqual(inputs.map((x: any) => x.custom_id), ["title", "start", "tier", "slots", "notes"]);
  assert.equal(inputs[0].value, "Ganking");
  assert.equal(inputs[1].value, "2026-12-01 18:00");
  assert.equal(inputs[2].value, "T8.0");
  assert.equal(inputs[3].value, "Tank - Mace\nHealer - Holy");
  assert.equal(inputs[4].value, undefined);
  const keep: any = await handleEditCommand(deps, command("edit"));
  assert.ok(keep.data.custom_id.endsWith(":k"));
});

test("only the creator, an officer or Manage Server may open edit and cancel", async () => {
  const { deps } = await setup();
  for (const handler of [handleEditCommand, handleCancelCommand]) {
    isEphemeral(await handler(deps, command("x", "stranger")));
    assert.ok(text(await handler(deps, command("x", "stranger"))).includes("Only the creator"));
    for (const member of [who("o", ["officer"]), who("admin", [], "32")]) {
      const r: any = await handler(deps, command("x", "x", { member }));
      assert.notEqual(r.data.content?.includes("Only the creator"), true);
    }
  }
});

test("a post without content says so; cancelled content is not editable", async () => {
  const { deps, sql } = await setup();
  assert.ok(text(await handleEditCommand(deps, command("edit", "boss", { channel: { id: "other", type: 11, parent_id: "fp" } }))).includes("no active content"));
  await sql`update content set status = 'locked'`;
  assert.ok(text(await handleEditCommand(deps, command("edit"))).includes("Only open"));
});

test("valid edit saves, refreshes the roster and pings on a start change", async () => {
  const { deps, sql, id, slots, edits, posts } = await setup();
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status) values ('g1', ${id}, 'alice', ${slots[0]}, 'signed')`;
  const r = await handleEditModal(deps, modal(id, "1", good));
  assert.equal(text(r), "Content updated.");
  const v = (await getRosterView(sql, id, NOW))!;
  assert.equal(v.title, "Ganking 2");
  assert.equal(v.hasLoot, true);
  assert.equal(v.slots.length, 3);
  assert.equal(v.slots[0]!.userId, "alice");
  assert.equal(edits.length, 1);
  assert.deepEqual([edits[0].channelId, edits[0].messageId], ["t1", "m1"]);
  assert.equal(posts.length, 1);
  assert.ok(posts[0].body.content.includes("<@alice>"));
  assert.deepEqual(posts[0].body.allowed_mentions, { users: ["alice"] });
});

test("an edit that keeps the start time pings nobody", async () => {
  const { deps, id, posts } = await setup();
  await handleEditModal(deps, modal(id, "k", { ...good, start: "2026-12-01 18:00" }));
  assert.equal(posts.length, 0);
});

test("invalid input and removing a held slot are refused with nothing saved", async () => {
  const { deps, sql, id, slots } = await setup();
  assert.ok(text(await handleEditModal(deps, modal(id, "k", { ...good, tier: "bad" }))).includes("Invalid tier"));
  assert.ok(text(await handleEditModal(deps, modal(id, "k", { ...good, start: "2020-01-01 10:00" }))).includes("future"));
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status) values ('g1', ${id}, 'bob', ${slots[1]}, 'signed')`;
  const r = await handleEditModal(deps, modal(id, "k", { ...good, slots: "Tank - Mace" }));
  assert.ok(text(r).includes("2. Healer - Holy"));
  assert.equal((await getRosterView(sql, id, NOW))!.title, "Ganking");
});

test("edit modal re-checks permission, guild and custom id", async () => {
  const { deps, sql, id } = await setup();
  assert.ok(text(await handleEditModal(deps, modal(id, "k", good, "stranger"))).includes("Only the creator"));
  assert.ok(text(await handleEditModal(deps, { ...modal(id, "k", good), guild_id: "g2" })).includes("no active content"));
  for (const bad of ["edit:nope:k", `edit:${id}:z`, `edit:${id}`]) {
    const i = modal(id, "k", good);
    (i.data as any).custom_id = bad;
    isEphemeral(await handleEditModal(deps, i));
  }
  assert.equal((await getRosterView(sql, id, NOW))!.title, "Ganking");
});

test("cancel asks for confirmation first and changes nothing", async () => {
  const { deps, sql, id } = await setup();
  const r: any = await handleCancelCommand(deps, command("cancel"));
  isEphemeral(r);
  assert.deepEqual(r.data.components[0].components.map((c: any) => c.custom_id), [`cancelyes:${id}`, `cancelno:${id}`]);
  assert.equal((await getRosterView(sql, id, NOW))!.status, "open");
});

test("confirming cancels, refreshes the roster and pings the signed-up members", async () => {
  const { deps, sql, id, slots, edits, posts } = await setup();
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status) values ('g1', ${id}, 'alice', ${slots[0]}, 'signed')`;
  const r: any = await handleCancelButton(deps, button(`cancelyes:${id}`));
  assert.equal(r.type, 7);
  assert.equal(r.data.content, "Content cancelled.");
  assert.deepEqual(r.data.components, []);
  assert.equal((await getRosterView(sql, id, NOW))!.status, "cancelled");
  assert.equal(edits.length, 1);
  assert.equal(posts.length, 1);
  assert.ok(posts[0].body.content.includes("<@alice>"));
  assert.deepEqual(posts[0].body.allowed_mentions, { users: ["alice"] });
  const again: any = await handleCancelButton(deps, button(`cancelyes:${id}`));
  assert.ok(again.data.content.includes("already"));
  assert.equal(posts.length, 1);
});

test("keep it and bad or unauthorized cancel buttons change nothing", async () => {
  const { deps, sql, id } = await setup();
  assert.equal(((await handleCancelButton(deps, button(`cancelno:${id}`))) as any).data.content, "Nothing changed.");
  assert.ok(text(await handleCancelButton(deps, button(`cancelyes:${id}`, "stranger"))).includes("Only the creator"));
  isEphemeral(await handleCancelButton(deps, button("cancelyes:nope")));
  isEphemeral(await handleCancelButton(deps, button(`cancelyes:${id}:x`)));
  assert.equal((await getRosterView(sql, id, NOW))!.status, "open");
});

test("after cancelling, a new content can be created (FR-019 link)", async () => {
  const { deps, sql, id } = await setup();
  await handleCancelButton(deps, button(`cancelyes:${id}`));
  await createContent(sql, { ...base, title: "Next" });
});

test("dispatch routes the edit and cancel subcommands, buttons and modal", async () => {
  const { deps, id } = await setup();
  const d = createDispatch(deps);
  assert.equal((await d(command("edit"))).type, 9);
  assert.equal((await d(command("cancel"))).type, 4);
  assert.equal((await d(button(`cancelno:${id}`))).type, 7);
  assert.equal((await d(modal(id, "k", good))).type, 4);
  assert.equal(text(await d(command("zzz"))), "Not implemented yet");
});

test("edit with a kind option carries it through and saves it; a wrong-type kind is refused", async () => {
  const { deps, sql, id } = await setup();
  const r: any = await handleEditCommand(deps, command("edit", "boss", {}, [{ name: "category", type: 3, value: "hellgate" }]));
  assert.equal(r.data.custom_id, `edit:${id}:k:hellgate`);
  assert.equal(text(await handleEditModal(deps, modal(id, "k:hellgate", good))), "Content updated.");
  assert.equal((await getRosterView(sql, id, NOW))!.kind, "hellgate");
  assert.ok(text(await handleEditCommand(deps, command("edit", "boss", {}, [{ name: "category", type: 3, value: "mists" }]))).includes("PvE category"));
  assert.equal((await getRosterView(sql, id, NOW))!.kind, "hellgate");
});
