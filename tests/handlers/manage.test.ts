import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setMessageId, type NewContent } from "../../src/db/content.ts";
import { handleCancelButton, handleCancel, openEditForm, handleEditModal, handleLock, handleUnlock } from "../../src/handlers/manage.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import { withHostActions } from "../helpers/host.ts";
import { DiscordApiError, type Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const base: NewContent = {
  guildId: "g1", threadId: "t1", type: "pvp", title: "Ganking", notes: null,
  startsAt: new Date("2026-12-01T18:00:00Z"),
  tier: "T8.0", hasLoot: false, createdBy: "boss",
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

test("Edit details opens a modal prefilled with the current values", async () => {
  const { deps, id } = await setup();
  const r: any = await openEditForm(deps, command("edit"));
  assert.equal(r.type, 9);
  assert.equal(r.data.custom_id, `edit:${id}:k`, "the category, loot vote and build link are kept; the Edit panel changes them");
  const inputs = r.data.components.map((row: any) => row.components[0]);
  assert.deepEqual(inputs.map((x: any) => x.custom_id), ["title", "start", "tier", "slots", "notes"]);
  assert.equal(inputs[0].value, "Ganking");
  assert.equal(inputs[1].value, "2026-12-01 18:00");
  assert.equal(inputs[2].value, "T8.0");
  assert.equal(inputs[3].value, "Tank - Mace\nHealer - Holy");
  assert.equal(inputs[4].value, undefined);
});

test("only the creator, an officer or Manage Server may open edit and cancel", async () => {
  const { deps } = await setup();
  for (const handler of [openEditForm, handleCancel]) {
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
  assert.ok(text(await openEditForm(deps, command("edit", "boss", { channel: { id: "other", type: 11, parent_id: "fp" } }))).includes("no active content"));
  await sql`update content set status = 'locked'`;
  assert.ok(text(await openEditForm(deps, command("edit"))).includes("Only open"));
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
  assert.ok(text(await handleEditModal(deps, modal(id, "k", { ...good, tier: "  " }))).includes("gear tier"));
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
  const r: any = await handleCancel(deps, command("cancel"));
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

test("the removed host commands point to Manage; the cancel buttons and the edit form still route", async () => {
  const { deps, id } = await setup();
  const d = createDispatch(deps);
  for (const sub of ["edit", "cancel", "lock", "unlock", "end", "reopen", "attendance", "duty", "assign"]) {
    assert.ok(text(await d(command(sub))).includes("Press **Manage**"), sub);
  }
  assert.equal((await d(button(`cancelno:${id}`))).type, 7);
  assert.equal((await d(modal(id, "k", good))).type, 4);
});

test("an edit form that carries a category (opened before 0.23.0) saves it; a wrong-type category is refused", async () => {
  const { deps, sql, id } = await setup();
  assert.equal(text(await handleEditModal(deps, modal(id, "k:hellgate", good))), "Content updated.");
  assert.equal((await getRosterView(sql, id, NOW))!.kind, "hellgate");
  assert.ok(text(await handleEditModal(deps, modal(id, "k:world-boss", good))).includes("PvE category"));
  assert.equal((await getRosterView(sql, id, NOW))!.kind, "hellgate");
});

// Content stays live after its start (FR-024), so a host must still be able to edit it. The form is prefilled with the
// current start, which is then in the past: an unchanged start must pass, a new start must still be in the future.
test("an admin can edit started content when the start time is left as it is", async () => {
  const { sql, deps, id } = await setup();
  const late: Deps = { ...deps, now: () => new Date("2026-12-01T19:00:00Z") };
  const values = { ...good, title: "Ganking", start: "2026-12-01 18:00", slots: "Tank - Mace\nHealer - Holy", notes: "new notes" };
  const r: any = await handleEditModal(late, { ...modal(id, "k", values), member: who("titanium", ["officer"]) });
  assert.ok(String(text(r)).startsWith("Content updated"), text(r));
  const [row] = await sql`select notes, starts_at from content where id = ${id}`;
  assert.equal(row!.notes, "new notes");
  assert.equal(row!.starts_at.toISOString(), "2026-12-01T18:00:00.000Z", "the start is untouched");
});

test("started content: a new start time must still be in the future", async () => {
  const { deps, id } = await setup();
  const late: Deps = { ...deps, now: () => new Date("2026-12-01T19:00:00Z") };
  const values = { ...good, title: "Ganking", start: "2026-12-01 17:00", slots: "Tank - Mace\nHealer - Holy" };
  const r: any = await handleEditModal(late, modal(id, "k", values, "boss"));
  assert.ok(String(text(r)).includes("not in the future"), text(r));
});

test("a failed roster edit takes the not-updated path, for edit, lock and unlock", async () => {
  const { deps, sql, id } = await setup();
  deps.rest.editMessage = async () => { throw new DiscordApiError(500, "boom"); };
  const orig = console.error;
  console.error = () => {};
  try {
    assert.ok(text(await handleEditModal(deps, modal(id, "1", good))).includes("could not be refreshed"));
    assert.ok(text(await handleLock(deps, command("lock"))).includes("will update on the next change"));
    await sql`update content set status = 'locked'`;
    assert.ok(text(await handleUnlock(deps, command("unlock"))).includes("will update on the next change"));
  } finally { console.error = orig; }
});

// Two-party CTA (FR-070).
async function setupTwo(cta = true) {
  const sql = await testSql();
  const id = await createContent(sql, {
    ...base, cta, slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }],
    slots2: [{ role: "Tank", weapon: "Axe" }, { role: "DPS", weapon: "Bow" }],
  });
  await setMessageId(sql, id, "m1");
  const edits: any[] = [];
  const rest: Rest = {
    async createMessage() { return { id: "p" }; },
    async editMessage(channelId, messageId, body) { edits.push({ channelId, messageId, body }); },
    async deleteMessage() {},
  };
  return { sql, id, edits, deps: { sql, rest, now: () => NOW } as Deps };
}
const p2form = (id: string, slots: string, userId = "boss"): Interaction => {
  const m = modal(id, "k", { slots }, userId);
  (m.data as any).custom_id = `edp:${id}`;
  return m;
};

test("Edit details labels party 1 and prefills only its lines; the Edit panel has Edit party 2 slots", async () => {
  const { deps, id } = await setupTwo();
  const r: any = await openEditForm(deps, command("edit"));
  const slots = r.data.components.map((row: any) => row.components[0]).find((x: any) => x.custom_id === "slots");
  assert.equal(slots.label, "Party 1 slots");
  assert.equal(slots.value, "Tank - Mace\nHealer - Holy");
  const d = createDispatch(deps);
  const panel: any = await d(button(`mg:e:${id}`));
  const ids = panel.data.components.flatMap((row: any) => row.components).map((c: any) => c.custom_id);
  assert.ok(ids.includes(`ed:p:${id}`));
  const opened: any = await d(button(`ed:p:${id}`));
  assert.equal(opened.type, 9);
  assert.equal(opened.data.custom_id, `edp:${id}`);
  const box = opened.data.components[0].components[0];
  assert.equal(box.label, "Party 2 slots");
  assert.equal(box.max_length, 1500);
  assert.equal(box.value, "Tank - Axe\nDPS - Bow");
});

test("a one-party content has no Edit party 2 slots button and keeps its Slots label", async () => {
  const { deps, id } = await setup();
  const panel: any = await createDispatch(deps)(button(`mg:e:${id}`));
  assert.ok(!panel.data.components.flatMap((row: any) => row.components).some((c: any) => c.custom_id === `ed:p:${id}`));
  const r: any = await openEditForm(deps, command("edit"));
  assert.match(r.data.components[3].components[0].label, /^Slots/);
});

test("the party 2 form saves party 2 only, refreshes every party, and keeps party 1 and the party count", async () => {
  const { sql, deps, id, edits } = await setupTwo();
  const r: any = await createDispatch(deps)(p2form(id, "Tank - Axe\nSupport - Locus"));
  assert.match(text(r), /Party 2 updated/);
  const v = (await getRosterView(sql, id, NOW))!;
  assert.deepEqual(v.slots.map((s) => `${s.party}:${s.role}-${s.weapon}`), ["1:Tank-Mace", "1:Healer-Holy", "2:Tank-Axe", "2:Support-Locus"]);
  assert.equal(v.partyCount, 2);
  assert.equal(v.title, "Ganking");
  assert.ok(edits.length >= 1);
});

test("the party 2 form refuses an unsupported role, naming Party 2, and a held slot's removal", async () => {
  const { sql, deps, id } = await setupTwo();
  const d = createDispatch(deps);
  const bad: any = await d(p2form(id, "Scout - Bow"));
  assert.match(text(bad), /Party 2, line 1: "Scout" is not a supported role/);
  const dps = (await getRosterView(sql, id, NOW))!.slots.find((s) => s.party === 2 && s.role === "DPS")!;
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status) values ('g1', ${id}, 'bob', ${dps.id}, 'signed')`;
  const held: any = await d(p2form(id, "Tank - Axe"));
  assert.match(text(held), /Party 2:/);
  assert.equal((await getRosterView(sql, id, NOW))!.slots.length, 4);
  isEphemeral(await d(p2form(id, "Tank - Axe", "stranger")));
  assert.match(text(await d(p2form(id, "Tank - Axe", "stranger"))), /Only the creator/);
});

test("Edit details on a CTA rejects an unsupported role and leaves party 2 alone; normal content accepts any role", async () => {
  const { sql, deps, id } = await setupTwo();
  const bad: any = await handleEditModal(deps, modal(id, "k", { ...good, slots: "Tank - Mace\nScout - Bow" }));
  assert.match(text(bad), /Party 1, line 2: "Scout" is not a supported role/);
  const ok: any = await handleEditModal(deps, modal(id, "k", { ...good, slots: "Tank - Mace\nHealer - Holy\nDPS - Bow" }));
  assert.match(text(ok), /Content updated/);
  const v = (await getRosterView(sql, id, NOW))!;
  assert.deepEqual(v.slots.map((s) => `${s.party}:${s.role}`), ["1:Tank", "1:Healer", "1:DPS", "2:Tank", "2:DPS"]);
  assert.equal(v.partyCount, 2);
  // normal content keeps accepting any role (the existing "Scout" case in `good`)
  await resetDb(sql);
  const n = await setup();
  assert.match(text(await handleEditModal(n.deps, modal(n.id, "k", good))), /Content updated/);
});

test("a party 2 slots save does not undo a concurrent change of the title, notes, start or tier", async () => {
  const { sql, deps, id } = await setupTwo();
  await sql`update content set title = 'Renamed', notes = 'new notes', gear_tier = 'T7.0', starts_at = '2026-12-05T20:00:00Z' where id = ${id}`;
  const r: any = await createDispatch(deps)(p2form(id, "Tank - Axe\nSupport - Locus"));
  assert.match(text(r), /Party 2 updated/);
  const v = (await getRosterView(sql, id, NOW))!;
  assert.equal(v.title, "Renamed");
  assert.equal(v.notes, "new notes");
  assert.equal(v.tier, "T7.0");
  assert.equal(v.startsAt.toISOString(), "2026-12-05T20:00:00.000Z");
  assert.deepEqual(v.slots.filter((s) => s.party === 2).map((s) => s.role), ["Tank", "Support"]);
});

test("an old CTA with a role outside the CTA list can still be edited; a new such line is refused", async () => {
  const sql = await testSql();
  const id = await createContent(sql, { ...base, cta: true, slots: [{ role: "Tank", weapon: "Mace" }, { role: "Heal", weapon: "Holy" }] });
  await setMessageId(sql, id, "m1");
  const rest: Rest = { async createMessage() { return { id: "p" }; }, async editMessage() {}, async deleteMessage() {} };
  const deps: Deps = { sql, rest, now: () => NOW };
  const ok: any = await handleEditModal(deps, modal(id, "k", { ...good, title: "New title", slots: "Tank - Mace\nHeal - Holy" }));
  assert.match(text(ok), /Content updated/);
  assert.equal((await getRosterView(sql, id, NOW))!.title, "New title");
  const bad: any = await handleEditModal(deps, modal(id, "k", { ...good, slots: "Tank - Mace\nHeal - Holy\nHeal - Fallen" }));
  assert.match(text(bad), /Line 3: "Heal" is not a supported role/);
  const changed: any = await handleEditModal(deps, modal(id, "k", { ...good, slots: "Tank - Mace\nHeal - Fallen" }));
  assert.match(text(changed), /Line 2: "Heal" is not a supported role/);
});

// A CTA's announcement follows the title and the start (ADR 0036 update 2026-11-10).
async function setupCta(failEdit = false) {
  const sql = await testSql();
  await sql`insert into cta_channel (guild_id, channel_id) values ('g1', 'cta-ch')`;
  const id = await createContent(sql, { ...base, cta: true, ownPost: true });
  await setMessageId(sql, id, "m1");
  const edits: any[] = [], renames: any[] = [];
  const rest: Rest = {
    async createMessage() { return { id: "p" }; },
    async editMessage(channelId, messageId, body) { edits.push({ channelId, messageId, body }); if (failEdit && channelId === "cta-ch") throw new Error("Missing Access SECRET"); },
    async deleteMessage() {},
    async editChannel(c: string, b: unknown) { renames.push({ c, b }); },
  };
  return { sql, id, edits, renames, deps: { sql, rest, now: () => NOW } as Deps };
}

test("a title edit of a CTA edits the announcement with the new name and keeps the Roster button", async () => {
  const { deps, id, edits, renames } = await setupCta();
  const r: any = await handleEditModal(deps, modal(id, "k", { ...good, slots: "Tank - Mace\nHealer - Holy\nDPS - Bow" }));
  assert.equal(text(r), "Content updated.");
  assert.equal(renames[0].b.name, "Ganking 2 | 2 Dec | 18:00 UTC");
  const a = edits.find((e) => e.channelId === "cta-ch");
  assert.equal(a.messageId, "t1");
  assert.ok(a.body.content.startsWith("📣 **Ganking 2 | 2 Dec | 18:00 UTC** · <t:"));
  assert.equal(a.body.components[0].components[0].url, "https://discord.com/channels/g1/t1/m1");
  assert.deepEqual(a.body.allowed_mentions, { parse: [] });
});

test("a failing announcement edit is logged without text and the edit still succeeds", async () => {
  const { deps, id } = await setupCta(true);
  const logs: string[] = [];
  const orig = console.error;
  console.error = (m: unknown) => { logs.push(String(m)); };
  try {
    const r: any = await handleEditModal(deps, modal(id, "k", { ...good, slots: "Tank - Mace\nHealer - Holy\nDPS - Bow" }));
    assert.equal(text(r), "Content updated.");
  } finally { console.error = orig; }
  assert.ok(logs.some((l) => l.includes("announcement_edit_failed")));
  assert.ok(!logs.join("").includes("SECRET"));
});

test("a title edit of normal content edits no announcement", async () => {
  const { deps, id, edits } = await setup();
  await handleEditModal(deps, modal(id, "k", { ...good, slots: "Tank - Mace\nHealer - Holy\nDPS - Bow" }));
  assert.ok(!edits.some((e: any) => e.channelId === "cta-ch"));
});
