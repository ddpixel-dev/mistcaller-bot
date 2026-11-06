import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { getDraft } from "../../src/db/draft.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { cardIdOf, discordProblems, flatComponents, plain, say, textOf } from "../helpers/discordLimits.ts";
import { handleEditModal } from "../../src/handlers/manage.ts";

const NOW = new Date("2026-10-24T12:00:00Z");
const GUILD = "100000000000000001";
const [FORUM, OWNER, OTHER] = ["300000000000000001", "100000000000000002", "100000000000000003"];
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup(o: { failEdit?: boolean; failPost?: boolean; renameFails?: boolean } = {}) {
  const sql = await testSql();
  const calls: { op: string; args: any[] }[] = [];
  let n = 0;
  const rest: Rest = {
    async createMessage(channel, body) { calls.push({ op: "createMessage", args: [channel, body] }); return { id: `m${++n}` }; },
    async editMessage(channel, id, body) { calls.push({ op: "editMessage", args: [channel, id, body] }); if (o.failEdit) throw new Error("edit failed"); },
    async deleteMessage(channel, id) { calls.push({ op: "deleteMessage", args: [channel, id] }); },
    async createForumPost(forum, body) { calls.push({ op: "createForumPost", args: [forum, body] }); if (o.failPost) throw new Error("403"); return { id: `post${++n}` }; },
    async forumTags() { return [{ id: "tag-pvp", name: "PvP" }, { id: "tag-zvz", name: "zvz" }, { id: "tag-pve", name: "PvE" }]; },
    async editChannel(id, body) { calls.push({ op: "editChannel", args: [id, body] }); if (o.renameFails && (body as any).name) throw new Error("429"); },
    async deleteChannel(id) { calls.push({ op: "deleteChannel", args: [id] }); },
    // A thread started from a message has that message's id.
    async startThread(channel, message, name) { calls.push({ op: "startThread", args: [channel, message, name] }); return { id: message }; },
  };
  await sql`insert into event_forum (guild_id, forum_id, type) values (${GUILD}, ${FORUM}, 'pvp'), (${GUILD}, ${FORUM}, 'pve'), (${GUILD}, ${FORUM}, 'pvx') on conflict do nothing`;
  const deps: Deps = { sql, rest, now: () => NOW };
  return { sql, deps, d: createDispatch(deps), calls };
}

const base = (over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: GUILD, channel: { id: "c1", type: 0 },
  member: { user: { id: OWNER }, roles: [], permissions: "32" }, ...over,
});
const press = (customId: string, values?: unknown[], over: Partial<Interaction> = {}) =>
  base({ data: { custom_id: customId, component_type: values ? 3 : 2, ...(values ? { values } : {}) }, ...over });
const form = (customId: string, fields: Record<string, string>, over: Partial<Interaction> = {}) =>
  base({ type: 5, data: { custom_id: customId, components: Object.entries(fields).map(([custom_id, value]) => ({ type: 1, components: [{ type: 4, custom_id, value }] })) }, ...over });
const command = (sub: string, options: unknown[] = [], over: Partial<Interaction> = {}, resolved?: unknown) =>
  base({ type: 2, data: { name: "content", options: [{ name: sub, type: 1, options }], ...(resolved ? { resolved } : {}) }, ...over });
const menus = (r: any) => flatComponents(r.data).filter((c) => c.type === 3);
const idOf = (r: any) => cardIdOf(r);
const details = { title: "Ava roam", start: "2026-10-25 18:00", tier: "T8", slots: "Tank - Mace\nHealer", notes: "" };

// The card opens from a button of the content-management channel (FR-059).
async function open(d: any, over: Partial<Interaction> = {}, which: "n" | "c" = "n") {
  const r: any = await d(press(`hub:${which}`, undefined, over));
  return { r, id: idOf(r) };
}

// ---- the creation card ----

test("the Category menu follows the Type: only that type's categories, and a category that no longer fits goes back to Other", async () => {
  const { d, sql } = await setup();
  const { id } = await open(d);
  let r: any = await d(press(`cc:type:${id}`, ["pvp"]));
  assert.equal(r.type, 7);
  let kind = menus(r)[1];
  assert.equal(kind.disabled, false);
  assert.ok(kind.options.some((o: any) => o.value === "zvz") && !kind.options.some((o: any) => o.value === "world-boss"));
  r = await d(press(`cc:kind:${id}`, ["zvz"]));
  assert.ok(say(r).startsWith("## 🏰"), "the card's heading shows the category's icon");
  r = await d(press(`cc:type:${id}`, ["pve"]));
  kind = menus(r)[1];
  assert.ok(kind.options.some((o: any) => o.value === "world-boss") && !kind.options.some((o: any) => o.value === "zvz"));
  assert.equal((await getDraft(sql, id, NOW))!.kind, "other");
  assert.equal(((await d(press(`cc:kind:${id}`, ["zvz"]))) as any).data.flags, 64, "a PvP category on PvE is refused");
  assert.equal(((await d(press(`cc:type:${id}`, ["moon"]))) as any).data.flags, 64);
  assert.equal(((await d(press(`cc:loot:${id}`, ["maybe"]))) as any).data.flags, 64);
  r = await d(press(`cc:loot:${id}`, ["1"]));
  assert.deepEqual(menus(r)[2].options.map((o: any) => !!o.default), [false, true]);
  assert.deepEqual(discordProblems(r.data), []);
});

test("Details opens one form filled from the card; what is typed is kept, and slots that do not parse stay as typed", async () => {
  const { d, sql } = await setup();
  const { id } = await open(d);
  const f: any = await d(press(`cc:details:${id}`));
  assert.equal(f.type, 9);
  const inputs = f.data.components.map((row: any) => row.components[0]);
  assert.deepEqual(inputs.map((x: any) => x.custom_id), ["title", "start", "tier", "slots", "notes"]);
  assert.equal(inputs[1].value, "2026-10-24 13:00", "the start is prefilled with now plus an hour");
  const r: any = await d(form(`ccd:${id}`, { ...details, slots: "Tank - Mace (Captain)" }));
  assert.equal(r.type, 7);
  assert.ok(say(r).includes("Ava roam") && say(r).includes("Unknown duty"));
  let stored = (await getDraft(sql, id, NOW))!;
  assert.deepEqual([stored.title, stored.startText, stored.gearTier, stored.notes, stored.slotsText], ["Ava roam", "2026-10-25 18:00", "T8", null, "Tank - Mace (Captain)"]);
  const again: any = await d(press(`cc:details:${id}`));
  assert.equal(again.data.components[3].components[0].value, "Tank - Mace (Captain)", "the typed slots come back to be fixed");
  await d(form(`ccd:${id}`, details));
  stored = (await getDraft(sql, id, NOW))!;
  assert.deepEqual([stored.slots.length, stored.slotsText], [2, null]);
});

test("Create is dimmed and the card lists what is still needed; a forced click creates nothing; only the opener can use the card", async () => {
  const { d, sql, calls } = await setup();
  const { r: opened, id } = await open(d);
  const createBtn = (m: any) => flatComponents(m.data).find((c: any) => c.custom_id === `cc:create:${id}`)!;
  assert.equal(createBtn(opened).disabled, true);
  assert.ok(say(opened).includes("Still needed before Create"));
  const r: any = await d(press(`cc:create:${id}`));
  assert.equal(r.type, 7);
  for (const p of ["Pick the type", "Add a title", "gear tier", "Add the slots"]) assert.ok(say(r).includes(p), p);
  assert.equal((await sql`select count(*)::int as n from content`)[0]!.n, 0);
  assert.equal(calls.length, 0);
  const stranger = { member: { user: { id: OTHER }, roles: [] } };
  for (const i of [press(`cc:create:${id}`, undefined, stranger), press(`cc:type:${id}`, ["pvp"], stranger), form(`ccd:${id}`, details, stranger)]) {
    assert.ok(((await d(i)) as any).data.content.includes("expired or is not yours"));
  }
});

test("Normal content opens a private card in the hub channel; it needs an event forum", async () => {
  const { d, sql } = await setup();
  const r: any = await d(press("hub:n"));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags & 64, 64, "private");
  assert.ok(say(r).includes("Create event"));
  assert.deepEqual(menus(r)[0].options.map((o: any) => o.value), ["pvp", "pve", "pvx"]);
  const [draft] = await sql`select thread_id, cta from slot_draft`;
  assert.deepEqual([draft!.thread_id, draft!.cta], ["c1", false]);
  await sql`delete from event_forum`;
  assert.ok(((await d(press("hub:n"))) as any).data.content.includes("No event forum is set"));
});

test("Create posts the roster in a new post of the event forum of its type, with matching tags, and links it", async () => {
  const { d, sql, calls } = await setup();
  await sql`delete from event_forum`;
  await sql`insert into event_forum (guild_id, forum_id, type) values (${GUILD}, 'pvp-forum', 'pvp'), (${GUILD}, 'pve-forum', 'pve')`;
  const { id } = await open(d);
  await d(press(`cc:type:${id}`, ["pvp"]));
  await d(press(`cc:kind:${id}`, ["zvz"]));
  await d(form(`ccd:${id}`, details));
  const r: any = await d(press(`cc:create:${id}`));
  assert.equal(say(r), `✅ Created: https://discord.com/channels/${GUILD}/post1/post1`);
  const post = calls.filter((c) => c.op === "createForumPost").at(-1)!;
  assert.deepEqual([post.args[0], post.args[1].name, post.args[1].applied_tags], ["pvp-forum", "Ava roam", ["tag-pvp", "tag-zvz"]]);
  const edit = calls.filter((c) => c.op === "editMessage").at(-1)!;
  assert.deepEqual(edit.args.slice(0, 2), ["post1", "post1"], "the post's first message becomes the roster");
  assert.ok(plain(textOf(edit.args[2])).includes("Ava roam"));
  assert.deepEqual(discordProblems(edit.args[2]), []);
  const [row] = await sql`select thread_id, message_id, own_post, cta, blank from content`;
  assert.deepEqual([row!.thread_id, row!.message_id, row!.own_post, row!.cta, row!.blank], ["post1", "post1", true, false, false]);
  assert.equal(await getDraft(sql, id, NOW), null);
  // PvE goes to the PvE forum
  const second = await open(d);
  await d(press(`cc:type:${second.id}`, ["pve"]));
  await d(form(`ccd:${second.id}`, { ...details, title: "Dungeon" }));
  await d(press(`cc:create:${second.id}`));
  assert.equal(calls.filter((c) => c.op === "createForumPost").at(-1)!.args[0], "pve-forum");
});

test("with no event forum for the type, Create says so on the card and keeps it", async () => {
  const { d, sql } = await setup();
  await sql`delete from event_forum`;
  await sql`insert into event_forum (guild_id, forum_id, type) values (${GUILD}, 'pvp-forum', 'pvp')`;
  const { id } = await open(d);
  await d(press(`cc:type:${id}`, ["pve"]));
  await d(form(`ccd:${id}`, details));
  const r: any = await d(press(`cc:create:${id}`));
  assert.ok(say(r).includes("No event forum is set for PvE content"), say(r));
  assert.equal((await sql`select count(*)::int as n from content`)[0]!.n, 0);
  assert.ok(await getDraft(sql, id, NOW));
});

test("when the roster cannot be put in the new post, the post and the content are removed", async () => {
  const { d, sql, calls } = await setup({ failEdit: true });
  const { id } = await open(d);
  await d(press(`cc:type:${id}`, ["pve"]));
  await d(form(`ccd:${id}`, details));
  const r: any = await d(press(`cc:create:${id}`));
  assert.equal(r.data.flags, 64);
  assert.ok(calls.some((c) => c.op === "deleteChannel" && c.args[0] === "post1"));
  assert.equal((await sql`select count(*)::int as n from content`)[0]!.n, 0);
  assert.ok(await getDraft(sql, id, NOW), "the card is kept to try again");
});

test("editing the title renames a post the bot made; a refused rename is explained; other posts are never renamed", async () => {
  for (const renameFails of [false, true]) {
    await resetDb(await testSql());
    const { d, deps, sql, calls } = await setup({ renameFails });
    const { id } = await open(d);
    await d(press(`cc:type:${id}`, ["pvp"]));
    await d(form(`ccd:${id}`, details));
    await d(press(`cc:create:${id}`));
    const [{ id: contentId }] = await sql`select id from content`;
    const edit = (title: string) => handleEditModal(deps, form(`edit:${contentId}:k`, { ...details, title }, { channel: { id: "post1", type: 11, parent_id: FORUM } }));
    const r: any = await edit("Ava roam 2");
    const renames = calls.filter((c) => c.op === "editChannel" && c.args[1].name);
    assert.deepEqual(renames.map((c) => c.args), [["post1", { name: "Ava roam 2" }]]);
    assert.equal(r.data.content.includes("two renames"), renameFails);
    await edit("Ava roam 2");
    assert.equal(calls.filter((c) => c.op === "editChannel" && c.args[1].name).length, 1, "same title: no rename");
  }
  const { deps, sql, calls } = await setup();
  const { createContent } = await import("../../src/db/content.ts");
  const own = await createContent(sql, { guildId: GUILD, threadId: "c9", type: "pvp", title: "Old", notes: null, startsAt: new Date("2026-12-01T18:00:00Z"), tier: "T8", hasLoot: false, createdBy: OWNER, slots: [{ role: "Tank", weapon: "Mace" }] });
  await handleEditModal(deps, form(`edit:${own}:k`, { ...details, title: "New" }, { channel: { id: "c9", type: 0 } }));
  assert.equal(calls.filter((c) => c.op === "editChannel").length, 0);
});

// ---- the setup of forums (FR-053, changed by ADR 0036) ----

const forumOpt = (name: string, value: string) => ({ name, type: 7, value });
const resolvedForum = { channels: { [FORUM]: { id: FORUM, type: 15 } } };
const setupForum = (d: any, type?: string) =>
  d(command("setup", [forumOpt("event-forum", FORUM), ...(type ? [{ name: "forum-type", type: 3, value: type }] : [])], {}, resolvedForum));

test("setup event-forum registers the forum for one type, the same forum can take more types, and there is no Any", async () => {
  const { d, sql, calls } = await setup();
  await sql`delete from event_forum`;
  const r: any = await setupForum(d, "pvp");
  assert.equal(r.data.flags, 64);
  assert.ok(r.data.content.includes("Create Posts") && r.data.content.includes("Manage Threads") && r.data.content.includes("Pin Messages"));
  assert.ok(r.data.content.includes("content-management channel"));
  assert.equal(calls.filter((c) => c.op === "createForumPost" || c.op === "editChannel").length, 0, "nothing is posted in the forum");
  assert.deepEqual((await sql`select forum_id, type, launcher_thread_id from event_forum`).map((x) => [x.forum_id, x.type, x.launcher_thread_id]), [[FORUM, "pvp", null]]);
  assert.ok(((await setupForum(d)) as any).data.content.includes("forum-type"), "the type must be given");
  const more: any = await setupForum(d, "pvx");
  assert.ok(more.data.content.includes("PvP, PvX"), more.data.content);
  assert.deepEqual((await sql`select type from event_forum order by type`).map((x) => x.type), ["pvp", "pvx"], "one forum serves PvP and PvX");
  assert.ok(((await setupForum(d, "any")) as any).data.content.includes("Pick PvP, PvE or PvX"));
  const one: any = await d(command("setup", [forumOpt("clear-event-forum", FORUM), { name: "forum-type", type: 3, value: "pvx" }], {}, resolvedForum));
  assert.ok(one.data.content.includes("still serves other types"), one.data.content);
  assert.deepEqual((await sql`select type from event_forum`).map((x) => x.type), ["pvp"]);
  const cleared: any = await d(command("setup", [forumOpt("clear-event-forum", FORUM)], {}, resolvedForum));
  assert.ok(cleared.data.content.includes("no longer an event forum"));
  assert.equal((await sql`select count(*)::int as n from event_forum`)[0]!.n, 0);
});

test("setting a type again moves it to the new forum; PvX has no fallback to another type's forum", async () => {
  const { d, sql } = await setup();
  await sql`delete from event_forum`;
  await setupForum(d, "pvp");
  const other = "300000002";
  await d(command("setup", [forumOpt("event-forum", other), { name: "forum-type", type: 3, value: "pvp" }], {}, { channels: { [other]: { id: other, type: 15 } } }));
  assert.deepEqual((await sql`select forum_id, type from event_forum`).map((x) => [x.forum_id, x.type]), [[other, "pvp"]]);
  const { id } = await open(d);
  await d(press(`cc:type:${id}`, ["pvx"]));
  await d(form(`ccd:${id}`, details));
  assert.ok(say((await d(press(`cc:create:${id}`))) as any).includes("No event forum is set for PvX content"));
});

test("setup event-forum is for admins and forums only; an old launcher post is removed when the forum is set again", async () => {
  const { d, sql, calls } = await setup();
  assert.ok(((await d(command("setup", [forumOpt("event-forum", FORUM), { name: "forum-type", type: 3, value: "pvp" }], { member: { user: { id: OTHER }, roles: [] } }, resolvedForum))) as any).data.content.includes("Only an admin"));
  assert.ok(((await d(command("setup", [forumOpt("event-forum", "c1")], {}, { channels: { c1: { type: 0 } } }))) as any).data.content.includes("forum channel"));
  await sql`delete from event_forum`;
  await sql`insert into event_forum (guild_id, type, forum_id, launcher_thread_id) values (${GUILD}, 'pvp', ${FORUM}, 'old-launcher')`;
  await setupForum(d, "pvp");
  assert.ok(calls.some((c) => c.op === "deleteChannel" && c.args[0] === "old-launcher"));
  assert.equal((await sql`select launcher_thread_id from event_forum`)[0]!.launcher_thread_id, null);
});

test("an old launcher button only points to the content-management channel", async () => {
  const { d } = await setup();
  assert.ok(((await d(press("lc:create"))) as any).data.content.includes("content-management channel"));
});

// ---- CTA and Blank (FR-059, FR-060) ----

const CTA_CHANNEL = "300000000000000009";
const member = (roles: string[], permissions = "0"): Partial<Interaction> => ({ member: { user: { id: OWNER }, roles, permissions } });

test("Special content is for admins and CTA roles, and needs a CTA channel", async () => {
  const { d, sql } = await setup();
  assert.ok(((await d(press("hub:c", undefined, member([])))) as any).data.content.includes("admins and members with a CTA role"));
  await sql`insert into guild_cta_role (guild_id, role_id) values (${GUILD}, 'callers')`;
  assert.ok(((await d(press("hub:c", undefined, member(["callers"])))) as any).data.content.includes("No CTA channel is set"));
  await sql`insert into cta_channel (guild_id, channel_id) values (${GUILD}, ${CTA_CHANNEL})`;
  const byRole: any = await d(press("hub:c", undefined, member(["callers"])));
  assert.equal(byRole.type, 4);
  assert.ok(say(byRole).includes("Create CTA (call to arms)"));
  assert.equal((await sql`select cta from slot_draft`)[0]!.cta, true);
  const byAdmin: any = await d(press("hub:c", undefined, member([], "32")));
  assert.equal(byAdmin.type, 4);
});

test("a CTA is announced in the CTA channel with a thread, the roster is in the thread, and the roles are checked again at Create", async () => {
  const { d, sql, calls } = await setup();
  await sql`insert into guild_cta_role (guild_id, role_id) values (${GUILD}, 'callers')`;
  await sql`insert into cta_channel (guild_id, channel_id) values (${GUILD}, ${CTA_CHANNEL})`;
  const { id } = await open(d, member(["callers"]), "c");
  await d(press(`cc:type:${id}`, ["pvp"], member(["callers"])));
  await d(form(`ccd:${id}`, details, member(["callers"])));
  const denied: any = await d(press(`cc:create:${id}`, undefined, member([])));
  assert.ok(denied.data.content.includes("admins and members with a CTA role"));
  assert.equal((await sql`select count(*)::int as n from content`)[0]!.n, 0);
  const r: any = await d(press(`cc:create:${id}`, undefined, member(["callers"])));
  assert.ok(say(r).startsWith("✅ Created"), say(r));
  const ops = calls.filter((c) => ["createMessage", "startThread", "editMessage", "createForumPost"].includes(c.op));
  assert.deepEqual(ops.map((c) => c.op), ["createMessage", "startThread", "createMessage"], "an announcement, a thread, then the roster in it");
  assert.equal(ops[0]!.args[0], CTA_CHANNEL);
  assert.ok(String(ops[0]!.args[1].content).includes("Ava roam") && ops[0]!.args[1].allowed_mentions.parse.length === 0);
  assert.deepEqual(ops[1]!.args, [CTA_CHANNEL, "m1", "Ava roam"]);
  assert.equal(ops[2]!.args[0], "m1", "the roster is posted in the thread, whose id is the announcement's");
  const [row] = await sql`select thread_id, message_id, own_post, cta from content`;
  assert.deepEqual([row!.thread_id, row!.message_id, row!.own_post, row!.cta], ["m1", "m2", true, true]);
  assert.equal(say(r), `✅ Created: https://discord.com/channels/${GUILD}/m1/m2`);
});

test("if the roster cannot be posted in a CTA thread, the thread, the announcement and the content are removed", async () => {
  const { d, sql, calls, deps } = await setup();
  await sql`insert into cta_channel (guild_id, channel_id) values (${GUILD}, ${CTA_CHANNEL})`;
  const failing = { ...deps, rest: { ...deps.rest, async createMessage(channel: string, body: any) { calls.push({ op: "createMessage", args: [channel, body] }); if (channel !== CTA_CHANNEL) throw new Error("403"); return { id: "ann1" }; } } };
  const { createDispatch } = await import("../../src/discord/dispatch.ts");
  const dd = createDispatch(failing as any);
  const { id } = await open(dd, member([], "32"), "c");
  await dd(press(`cc:type:${id}`, ["pvp"], member([], "32")));
  await dd(form(`ccd:${id}`, details, member([], "32")));
  const r: any = await dd(press(`cc:create:${id}`, undefined, member([], "32")));
  assert.equal(r.data.flags, 64);
  assert.ok(calls.some((c) => c.op === "deleteChannel" && c.args[0] === "ann1"), "the thread is deleted");
  assert.ok(calls.some((c) => c.op === "deleteMessage" && c.args[0] === CTA_CHANNEL && c.args[1] === "ann1"), "so is the announcement");
  assert.equal((await sql`select count(*)::int as n from content`)[0]!.n, 0);
  assert.ok(await getDraft(sql, id, NOW));
});

test("Blank template: needs the type for normal content; opens a form with title, start, gear tier and description; posts a content without a roster", async () => {
  const { d, sql, calls } = await setup();
  const { id } = await open(d);
  const noType: any = await d(press(`cc:blank:${id}`));
  assert.equal(noType.type, 7);
  assert.ok(say(noType).includes("Pick the type of content (PvP or PvE) first"));
  await d(press(`cc:type:${id}`, ["pve"]));
  const formResp: any = await d(press(`cc:blank:${id}`));
  assert.equal(formResp.type, 9);
  assert.equal(formResp.data.custom_id, `ccl:${id}`);
  assert.deepEqual(formResp.data.components.map((r: any) => r.components[0].custom_id), ["title", "start", "tier", "notes"]);
  const bad: any = await d(form(`ccl:${id}`, { title: "", start: "soon", tier: "", notes: "" }));
  assert.equal(bad.type, 7);
  assert.ok(say(bad).includes("Add a title"));
  const ok: any = await d(form(`ccl:${id}`, { title: "Meet at the portal", start: "2026-10-25 18:00", tier: "T8", notes: "Bring food" }));
  assert.ok(say(ok).startsWith("✅ Created"), say(ok));
  const [row] = await sql`select blank, cta, type, title, notes from content`;
  assert.deepEqual([row!.blank, row!.cta, row!.type, row!.title, row!.notes], [true, false, "pve", "Meet at the portal", "Bring food"]);
  assert.equal((await sql`select count(*)::int as n from slot`)[0]!.n, 0);
  const edit = calls.filter((c) => c.op === "editMessage").at(-1)!;
  const buttons = flatComponents(edit.args[2]).filter((c: any) => c.type === 2).map((c: any) => c.label);
  assert.deepEqual(buttons, ["Manage"]);
});

test("a blank CTA needs no type: it is PvX and is announced in the CTA channel", async () => {
  const { d, sql, calls } = await setup();
  await sql`insert into cta_channel (guild_id, channel_id) values (${GUILD}, ${CTA_CHANNEL})`;
  const { id } = await open(d, member([], "32"), "c");
  const ok: any = await d(form(`ccl:${id}`, { title: "All hands", start: "2026-10-25 18:00", tier: "T8", notes: "" }, member([], "32")));
  assert.ok(say(ok).startsWith("✅ Created"), say(ok));
  const [row] = await sql`select blank, cta, type from content`;
  assert.deepEqual([row!.blank, row!.cta, row!.type], [true, true, "pvx"]);
  assert.ok(calls.some((c) => c.op === "startThread" && c.args[0] === CTA_CHANNEL));
});

test("Create lights up once the card is complete; the tips sit under the buttons after a divider, one 💡 per line", async () => {
  const { d } = await setup();
  const { id } = await open(d);
  await d(press(`cc:type:${id}`, ["pvp"]));
  const r: any = await d(form(`ccd:${id}`, details));
  assert.equal(flatComponents(r.data).find((c: any) => c.custom_id === `cc:create:${id}`)!.disabled, false);
  assert.ok(say(r).includes("Ready: press **Create**"));
  const parts = r.data.components[0].components;
  const buttonsAt = parts.findIndex((c: any) => c.type === 1 && c.components.some((b: any) => b.custom_id === `cc:create:${id}`));
  assert.deepEqual(parts.slice(buttonsAt + 1).map((c: any) => c.type), [14, 10], "a divider, then the tips, after the buttons");
  const tips = parts.at(-1).content.split("\n");
  assert.ok(tips.length >= 3 && tips.every((l: string) => l.startsWith("-# 💡 ")));
  assert.ok(!parts[0].content.includes("💡"), "no tips above the menus");
  assert.deepEqual(discordProblems(r.data), []);
});
