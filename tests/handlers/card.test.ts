import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { getDraft } from "../../src/db/draft.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { cardIdOf, discordProblems, flatComponents, modalProblems, plain, say, textOf } from "../helpers/discordLimits.ts";
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
// The Preset menu is first on the card, so the other menus keep their old order without it.
const menus = (r: any) => flatComponents(r.data).filter((c) => c.type === 3 && !String(c.custom_id).startsWith("cc:preset:"));
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

test("Plan Content opens a private card in the hub channel; it needs an event forum", async () => {
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
  assert.deepEqual([post.args[0], post.args[1].name, post.args[1].applied_tags], ["pvp-forum", "Ava roam | 25 Oct | 18:00 UTC", ["tag-pvp", "tag-zvz"]]);
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
    assert.deepEqual(renames.map((c) => c.args), [["post1", { name: "Ava roam 2 | 25 Oct | 18:00 UTC" }]]);
    assert.equal(r.data.content.includes("two renames"), renameFails);
    await edit("Ava roam 2");
    assert.equal(calls.filter((c) => c.op === "editChannel" && c.args[1].name).length, 1, "same title and start: no rename");
    // The post name carries the date and time, so a new start renames it too.
    await handleEditModal(deps, form(`edit:${contentId}:k`, { ...details, title: "Ava roam 2", start: "2026-10-26 20:00" }, { channel: { id: "post1", type: 11, parent_id: FORUM } }));
    const after = calls.filter((c) => c.op === "editChannel" && c.args[1].name);
    assert.equal(after.length, 2, "a new start renames the post");
    assert.deepEqual(after.at(-1)!.args, ["post1", { name: "Ava roam 2 | 26 Oct | 20:00 UTC" }]);
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

test("Schedule CTA is for admins and CTA roles, and needs a CTA channel", async () => {
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

test("a CTA's roster is the message in the CTA channel, the thread starts from it, and the roles are checked again at Create", async () => {
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
  const ops = calls.filter((c) => ["createMessage", "startThread", "editMessage", "createForumPost", "pinMessage"].includes(c.op));
  assert.deepEqual(ops.map((c) => c.op), ["createMessage", "startThread", "editMessage"], "a placeholder in the channel, the thread from it, then the placeholder becomes the roster; nothing is pinned");
  assert.equal(ops[0]!.args[0], CTA_CHANNEL);
  assert.ok(ops[0]!.args[1].allowed_mentions.parse.length === 0);
  assert.deepEqual(ops[1]!.args, [CTA_CHANNEL, "m1", "Ava roam | 25 Oct | 18:00 UTC"]);
  assert.deepEqual(ops[2]!.args.slice(0, 2), [CTA_CHANNEL, "m1"], "the roster is edited in the channel");
  assert.ok(JSON.stringify(ops[2]!.args[2]).includes("Ava roam"));
  const [row] = await sql`select thread_id, message_id, own_post, cta from content`;
  assert.deepEqual([row!.thread_id, row!.message_id, row!.own_post, row!.cta], ["m1", "m1", true, true]);
  assert.equal((await sql`select roster_channel_id from content`)[0]!.roster_channel_id, CTA_CHANNEL);
  assert.equal(say(r), `✅ Created: https://discord.com/channels/${GUILD}/${CTA_CHANNEL}/m1`);
});

test("if the roster cannot be posted in the CTA channel, the thread, the placeholder and the content are removed", async () => {
  const { d, sql, calls, deps } = await setup();
  await sql`insert into cta_channel (guild_id, channel_id) values (${GUILD}, ${CTA_CHANNEL})`;
  const failing = { ...deps, rest: { ...deps.rest, async createMessage(channel: string, body: any) { calls.push({ op: "createMessage", args: [channel, body] }); return { id: "ann1" }; }, async editMessage() { throw new Error("403"); } } };
  const { createDispatch } = await import("../../src/discord/dispatch.ts");
  const dd = createDispatch(failing as any);
  const { id } = await open(dd, member([], "32"), "c");
  await dd(press(`cc:type:${id}`, ["pvp"], member([], "32")));
  await dd(form(`ccd:${id}`, details, member([], "32")));
  const r: any = await dd(press(`cc:create:${id}`, undefined, member([], "32")));
  assert.equal(r.data.flags, 64);
  assert.ok(calls.some((c) => c.op === "deleteChannel" && c.args[0] === "ann1"), "the thread is deleted");
  assert.ok(calls.some((c) => c.op === "deleteMessage" && c.args[0] === CTA_CHANNEL && c.args[1] === "ann1"), "so is the placeholder");
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

test("Plan Content and Schedule CTA both offer the server's saved presets, and picking one fills the slots", async () => {
  const { d, sql } = await setup();
  const { savePreset } = await import("../../src/db/preset.ts");
  await savePreset(sql, { guildId: GUILD, name: "Ava raid", slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }], createdBy: OWNER });
  await sql`insert into cta_channel (guild_id, channel_id) values (${GUILD}, 'cta-ch') on conflict do nothing`;
  await sql`insert into guild_cta_role (guild_id, role_id) values (${GUILD}, 'r1') on conflict do nothing`;
  for (const [button, member] of [["hub:n", undefined], ["hub:c", { member: { user: { id: OWNER }, roles: ["r1"] } }]] as const) {
    const r: any = await d(press(button, undefined, member as any));
    const menu = flatComponents(r.data).find((c: any) => String(c.custom_id).startsWith("cc:preset:"));
    assert.ok(menu, `${button}: the Preset menu is on the card`);
    assert.deepEqual(menu!.options.map((o: any) => o.label), ["Ava raid"]);
    assert.deepEqual(discordProblems(r.data), []);
  }
});

test("with no presets the card still shows a dimmed Preset menu that says how to save one; a forced click only explains", async () => {
  const { d, sql } = await setup();
  const r: any = await d(press("hub:n"));
  const menu = flatComponents(r.data).find((c: any) => String(c.custom_id).startsWith("cc:preset:"))!;
  assert.ok(menu, "the menu is on the card");
  assert.equal(menu.disabled, true);
  assert.ok(menu.options[0].label.includes("/content preset save"));
  assert.deepEqual(discordProblems(r.data), []);
  const id = cardIdOf(r);
  const forced: any = await d(press(`cc:preset:${id}`, ["-"]));
  assert.ok(forced.data.content.includes("no presets yet"), forced.data.content);
  assert.equal((await sql`select count(*)::int as n from slot_draft where slots_text is not null`)[0]!.n, 0);
});

// ---- presets keep the whole card (ADR 0039) ----

test("the Preset menu is the first menu on the card", async () => {
  const { d } = await setup();
  const r: any = await d(press("hub:n"));
  const all = flatComponents(r.data).filter((c: any) => c.type === 3);
  assert.ok(String(all[0].custom_id).startsWith("cc:preset:"), "Choose from preset comes first");
  assert.ok(String(all[1].custom_id).startsWith("cc:type:"));
});

test("a preset saved from a valid card fills the type, category, loot vote, sign-up, title, tier, notes and slots on a new card, but not the start", async () => {
  const { d, sql } = await setup();
  const first = (await open(d)).id as string;
  await d(form(`ccd:${first}`, { ...details, title: "Ava roam", tier: "T8.3", notes: "Bring food" }));
  await d(press(`cc:type:${first}`, ["pvp"]));
  await d(press(`cc:kind:${first}`, ["zvz"]));
  await d(press(`cc:loot:${first}`, ["1"]));
  await d(press(`cc:sel:${first}`, ["1"]));
  assert.ok(say((await d(form(`ccp:${first}`, { name: "Ava roam" }, admin))) as any).includes("Saved the preset"));
  const [row] = await sql`select settings from slot_preset`;
  assert.deepEqual(row!.settings, { type: "pvp", kind: "zvz", loot: true, selection: true, title: "Ava roam", tier: "T8.3", notes: "Bring food", buildRef: null });
  // a new card: one pick sets everything
  const second: any = await open(d);
  const [{ id: presetId }] = await sql`select id from slot_preset`;
  const r: any = await d(press(`cc:preset:${second.id}`, [presetId]));
  assert.ok(say(r).includes("Filled from the preset"), say(r));
  const draft = (await getDraft(sql, second.id, NOW))!;
  assert.deepEqual([draft.type, draft.kind, draft.loot, draft.selection, draft.title, draft.gearTier, draft.notes], ["pvp", "zvz", true, true, "Ava roam", "T8.3", "Bring food"]);
  assert.deepEqual(draft.slots.map((s) => s.role), ["Tank", "Healer"]);
  assert.notEqual(draft.startText, "2026-10-25 18:00", "the start time is not part of a preset");
  assert.deepEqual(discordProblems(r.data), []);
});

test("an older preset with no settings still fills the slots only", async () => {
  const { d, sql } = await setup();
  await sql`insert into slot_preset (guild_id, name, slots, created_by) values (${GUILD}, 'Old', '[{"role":"Tank","weapon":"Mace"}]'::jsonb, 'o')`;
  const { id } = await open(d);
  await d(press(`cc:type:${id}`, ["pve"]));
  const [{ id: presetId }] = await sql`select id from slot_preset`;
  const r: any = await d(press(`cc:preset:${id}`, [presetId]));
  assert.ok(say(r).includes("slots only"));
  const draft = (await getDraft(sql, id, NOW))!;
  assert.deepEqual([draft.type, draft.slots.map((s) => s.role)], ["pve", ["Tank"]]);
});

// ---- Manage presets (ADR 0039) ----

const admin = { member: { user: { id: OWNER }, roles: [], permissions: "32" } };
const plainMember = { member: { user: { id: OWNER }, roles: [], permissions: "0" } };
const labels = (r: any) => flatComponents(r.data).filter((c: any) => c.type === 2).map((c: any) => c.label);
const button = (r: any, label: string) => flatComponents(r.data).find((c: any) => c.type === 2 && c.label === label)!;

async function validCard(d: any) {
  const { id } = await open(d);
  await d(form(`ccd:${id}`, details));
  await d(press(`cc:type:${id}`, ["pvp"]));
  await d(press(`cc:kind:${id}`, ["zvz"]));
  return id as string;
}

test("Manage presets sits beside Blank template and opens a panel in place with Save as preset, Delete preset and Back", async () => {
  const { d } = await setup();
  const { r, id } = await open(d);
  assert.deepEqual(labels(r).slice(0, 2), ["Blank template", "Manage presets"]);
  const panel: any = await d(press(`cc:presets:${id}`, undefined, admin));
  assert.equal(panel.type, 7, "it replaces the card in the same message");
  assert.deepEqual(labels(panel), ["Save as preset", "Delete preset", "Back to the card"]);
  assert.ok(say(panel).includes("saves this card as it is now, if it is valid") && say(panel).includes("The start time is not saved"));
  assert.deepEqual(discordProblems(panel.data), []);
  const back: any = await d(press(`cc:back:${id}`, undefined, admin));
  assert.ok(labels(back).includes("Manage presets") && labels(back).includes("Create"), "Back shows the card again");
});

test("Manage presets is only for the configured roles: an admin role, Manage Server or Administrator; every step checks", async () => {
  const { d, sql } = await setup();
  const id = await validCard(d);
  const { savePreset } = await import("../../src/db/preset.ts");
  await savePreset(sql, { guildId: GUILD, name: "Ava", slots: [{ role: "R", weapon: "W" }], createdBy: OWNER });
  const [{ id: avaId }] = await sql`select id from slot_preset`;
  for (const [custom, values] of [[`cc:presets:${id}`, undefined], [`cc:savepreset:${id}`, undefined], [`cc:delpreset:${id}`, undefined], [`cc:delpick:${id}`, [avaId]], [`cc:delyes:${id}:${avaId}`, undefined]] as const) {
    assert.ok(((await d(press(custom, values as any, plainMember))) as any).data.content.includes("Only admins"), custom);
  }
  assert.ok(((await d(form(`ccp:${id}`, { name: "Sneaky" }, plainMember))) as any).data.content.includes("Only admins"));
  assert.deepEqual((await sql`select name from slot_preset`).map((x) => x.name), ["Ava"], "nothing changed");
  await sql`insert into guild_admin_role (guild_id, role_id) values (${GUILD}, 'officer')`;
  const officer = { member: { user: { id: OWNER }, roles: ["officer"], permissions: "0" } };
  assert.equal(((await d(press(`cc:presets:${id}`, undefined, officer))) as any).type, 7, "a configured admin role opens it");
  const administrator = { member: { user: { id: OWNER }, roles: [], permissions: "8" } };
  assert.equal(((await d(press(`cc:presets:${id}`, undefined, administrator))) as any).type, 7);
});

test("Save as preset is lit only when the card is valid, opens a name form, and saves; the same name replaces", async () => {
  const { d, sql } = await setup();
  const { id: bad } = await open(d);
  const notReady: any = await d(press(`cc:presets:${bad}`, undefined, admin));
  assert.equal(button(notReady, "Save as preset").disabled, true);
  assert.ok(say(notReady).includes("not ready to save yet") && say(notReady).includes("Add a title"), say(notReady));
  const forced: any = await d(press(`cc:savepreset:${bad}`, undefined, admin));
  assert.equal(forced.type, 7, "a forced click opens no form");
  assert.equal(((await d(form(`ccp:${bad}`, { name: "Nope" }, admin))) as any).type, 7);
  assert.equal((await sql`select count(*)::int as n from slot_preset`)[0]!.n, 0);

  const id = await validCard(d);
  const ready: any = await d(press(`cc:presets:${id}`, undefined, admin));
  assert.equal(button(ready, "Save as preset").disabled, false);
  const modal: any = await d(press(`cc:savepreset:${id}`, undefined, admin));
  assert.equal(modal.type, 9);
  assert.equal(modal.data.custom_id, `ccp:${id}`);
  const saved: any = await d(form(`ccp:${id}`, { name: "Ava roam" }, admin));
  assert.equal(saved.type, 7);
  assert.ok(say(saved).includes("Saved the preset") && say(saved).includes("2 positions"), say(saved));
  assert.equal(button(saved, "Delete preset").disabled, false, "there is something to delete now");
  assert.deepEqual(discordProblems(saved.data), []);
  assert.ok(say((await d(form(`ccp:${id}`, { name: "ava ROAM" }, admin))) as any).includes("was replaced"));
  assert.equal((await sql`select count(*)::int as n from slot_preset`)[0]!.n, 1);
  assert.ok(say((await d(form(`ccp:${id}`, { name: "   " }, admin))) as any).includes("needs a name"));
  const stranger = { member: { user: { id: OTHER }, roles: [], permissions: "32" } };
  assert.ok(((await d(form(`ccp:${id}`, { name: "Mine" }, stranger))) as any).data.content.includes("expired or is not yours"));
});

test("a full server (25 presets) can still replace a name but not add one", async () => {
  const { d, sql } = await setup();
  const { savePreset } = await import("../../src/db/preset.ts");
  for (let n = 0; n < 25; n++) await savePreset(sql, { guildId: GUILD, name: `p${n}`, slots: [{ role: "R", weapon: "W" }], createdBy: OWNER });
  const id = await validCard(d);
  assert.ok(say((await d(form(`ccp:${id}`, { name: "one more" }, admin))) as any).includes("25 presets"));
  assert.ok(say((await d(form(`ccp:${id}`, { name: "P3" }, admin))) as any).includes("was replaced"));
});

test("Delete preset: pick, confirm, gone; Keep it deletes nothing; only this server's presets; dimmed with none", async () => {
  const { d, sql } = await setup();
  const { savePreset } = await import("../../src/db/preset.ts");
  const { id } = await open(d);
  assert.equal(button((await d(press(`cc:presets:${id}`, undefined, admin))) as any, "Delete preset").disabled, true, "dimmed with none");
  for (const name of ["Ava", "Roam"]) await savePreset(sql, { guildId: GUILD, name, slots: [{ role: "R", weapon: "W" }], createdBy: OWNER });
  await savePreset(sql, { guildId: "other-guild", name: "Theirs", slots: [{ role: "R", weapon: "W" }], createdBy: OWNER });
  const pick: any = await d(press(`cc:delpreset:${id}`, undefined, admin));
  const menu = flatComponents(pick.data).find((c: any) => c.type === 3)!;
  assert.deepEqual(menu.options.map((o: any) => o.label), ["Ava", "Roam"], "this server's presets only");
  const [{ id: avaId }] = await sql`select id from slot_preset where name = 'Ava'`;
  const confirm: any = await d(press(menu.custom_id, [avaId], admin));
  assert.ok(say(confirm).includes("Delete the preset **Ava**?"));
  assert.equal(button(confirm, "Delete").style, 4);
  const kept: any = await d(press(button(confirm, "Keep it").custom_id, undefined, admin));
  assert.ok(labels(kept).includes("Save as preset"), "Keep it goes back to the panel");
  assert.equal((await sql`select count(*)::int as n from slot_preset where guild_id = ${GUILD}`)[0]!.n, 2);
  const done: any = await d(press(button(confirm, "Delete").custom_id, undefined, admin));
  assert.ok(say(done).includes("Deleted the preset **Ava**"), say(done));
  assert.deepEqual((await sql`select name from slot_preset where guild_id = ${GUILD}`).map((x) => x.name), ["Roam"]);
  assert.ok(say((await d(press(button(confirm, "Delete").custom_id, undefined, admin))) as any).includes("no longer exists"), "a second press is harmless");
  const [{ id: theirs }] = await sql`select id from slot_preset where guild_id = 'other-guild'`;
  assert.ok(say((await d(press(`cc:delyes:${id}:${theirs}`, undefined, admin))) as any).includes("no longer exists"), "another server's preset");
  assert.equal((await sql`select count(*)::int as n from slot_preset where guild_id = 'other-guild'`)[0]!.n, 1);
  assert.ok(((await d(press(`cc:delyes:${id}:not-a-uuid`, undefined, admin))) as any).data.content.includes("expired or is not yours"));
});

// ---- the CTA message forward (FR-069) ----

async function withCtaMessage(o: { forwardFails?: boolean } = {}) {
  const ctx = await setup();
  const { sql, calls } = ctx;
  await sql`insert into cta_channel (guild_id, channel_id) values (${GUILD}, ${CTA_CHANNEL}) on conflict do nothing`;
  await sql`insert into cta_message (guild_id, channel_id, message_id) values (${GUILD}, 'src-chan', 'src-msg') on conflict do nothing`;
  const rest: any = {
    ...ctx.deps.rest,
    async createMessage(c: string, body: any) {
      if (body?.message_reference) {
        calls.push({ op: "forward", args: [c, body] });
        if (o.forwardFails) { const { DiscordApiError } = await import("../../src/discord/rest.ts"); throw new DiscordApiError(404, "x", 10008); }
        return { id: "m3" };
      }
      return ctx.deps.rest.createMessage(c, body);
    },
    async pinMessage(c: string, m: string) { calls.push({ op: "pinMessage", args: [c, m] }); },
  };
  const { createDispatch } = await import("../../src/discord/dispatch.ts");
  return { ...ctx, d: createDispatch({ ...ctx.deps, rest } as any) };
}

test("a CTA made with Create gets a pinned forward of the CTA message after the roster", async () => {
  const { d, calls } = await withCtaMessage();
  const { id } = await open(d, member([], "32"), "c");
  await d(press(`cc:type:${id}`, ["pvp"], member([], "32")));
  await d(form(`ccd:${id}`, details, member([], "32")));
  const r: any = await d(press(`cc:create:${id}`, undefined, member([], "32")));
  assert.equal(say(r), `✅ Created: https://discord.com/channels/${GUILD}/${CTA_CHANNEL}/m1`);
  assert.deepEqual(calls.filter((c) => c.op === "pinMessage").map((c) => c.args), [["m1", "m3"]], "only the forward is pinned; the roster heads the thread");
  assert.ok(calls.findIndex((c) => c.op === "forward") < calls.findIndex((c) => c.op === "pinMessage"), "the forward is posted, then pinned");
  assert.equal(calls.filter((c) => c.op === "getMessage").length, 0, "the bot never reads the source");
  assert.deepEqual(calls.find((c) => c.op === "forward")!.args[1].message_reference, { type: 1, guild_id: GUILD, channel_id: "src-chan", message_id: "src-msg", fail_if_not_exists: true });
});

test("when the CTA message cannot be forwarded the CTA is still created and the reply ends with a note", async () => {
  const missing = await withCtaMessage({ forwardFails: true });
  const { id: id2 } = await open(missing.d, member([], "32"), "c");
  await missing.d(press(`cc:type:${id2}`, ["pvp"], member([], "32")));
  await missing.d(form(`ccd:${id2}`, details, member([], "32")));
  const r2: any = await missing.d(press(`cc:create:${id2}`, undefined, member([], "32")));
  const lines = say(r2).split("\n");
  assert.ok(lines[0]!.startsWith("✅ Created"));
  assert.equal(lines.length, 2);
  assert.ok(lines[1]!.startsWith("The CTA message was not added"));
});

test("a blank CTA gets the forward too, and normal content never forwards the CTA message", async () => {
  const { d, calls } = await withCtaMessage();
  const { id } = await open(d, member([], "32"), "c");
  const ok: any = await d(form(`ccl:${id}`, { title: "All hands", start: "2026-10-25 18:00", tier: "T8", notes: "" }, member([], "32")));
  assert.ok(say(ok).startsWith("✅ Created"));
  assert.equal(calls.filter((c) => c.op === "forward").length, 1);
  const normal = await withCtaMessage();
  const { id: nid } = await open(normal.d, member([], "32"), "n");
  await normal.d(press(`cc:type:${nid}`, ["pvp"], member([], "32")));
  await normal.d(form(`ccd:${nid}`, details, member([], "32")));
  const r: any = await normal.d(press(`cc:create:${nid}`, undefined, member([], "32")));
  assert.ok(say(r).startsWith("✅ Created"), say(r));
  assert.equal(normal.calls.filter((c) => c.op === "forward").length, 0);
});

// ---- the CTA card: Parties and party 2 slots (FR-070) ----

const adminCta = { member: { user: { id: OWNER }, roles: [], permissions: "32" } };
async function ctaCard(d: any, sql: any) {
  await sql`insert into cta_channel (guild_id, channel_id) values (${GUILD}, ${CTA_CHANNEL}) on conflict do nothing`;
  return (await open(d, adminCta, "c")).id as string;
}
const partiesMenu = (r: any): any => flatComponents(r.data).find((c: any) => String(c.custom_id).startsWith("cc:parties:"));
const btnOf = (r: any, id: string): any => flatComponents(r.data).find((c: any) => c.custom_id === id);

test("the Parties menu is on a CTA card only; the CTA card has no Type or Category menu, normal content keeps them", async () => {
  const { d, sql } = await setup();
  const normal: any = await d(press("hub:n"));
  assert.equal(partiesMenu(normal), undefined);
  assert.ok(flatComponents(normal.data).some((c: any) => String(c.custom_id).startsWith("cc:type:")));
  await sql`insert into cta_channel (guild_id, channel_id) values (${GUILD}, ${CTA_CHANNEL})`;
  const r: any = await d(press("hub:c", undefined, adminCta));
  const id = idOf(r);
  const menu = partiesMenu(r);
  assert.deepEqual(menu.options.map((o: any) => [o.value, !!o.default]), [["1", true], ["2", false]]);
  assert.ok(!flatComponents(r.data).some((c: any) => /^cc:(type|kind):/.test(String(c.custom_id))));
  assert.equal(btnOf(r, `cc:p2:${id}`), undefined, "no Party 2 button with one party");
  assert.deepEqual(discordProblems(r.data), []);
});

test("choosing 2 parties stores it, relabels Details, shows Party 2 slots and Copy party 1; going back to 1 clears party 2", async () => {
  const { d, sql } = await setup();
  const id = await ctaCard(d, sql);
  let r: any = await d(press(`cc:parties:${id}`, ["2"], adminCta));
  assert.equal((await getDraft(sql, id, NOW))!.parties, 2);
  assert.deepEqual(partiesMenu(r).options.map((o: any) => !!o.default), [false, true]);
  assert.ok(btnOf(r, `cc:p2:${id}`) && btnOf(r, `cc:copy:${id}`));
  assert.equal(btnOf(r, `cc:p2:${id}`).label, "Party 2 slots");
  assert.equal(btnOf(r, `cc:copy:${id}`).label, "Copy party 1");
  assert.ok(say(r).includes("Roles fills party 1"));
  assert.deepEqual(discordProblems(r.data), []);
  const det: any = await d(press(`cc:details:${id}`, undefined, adminCta));
  const slotsInput = det.data.components.map((row: any) => row.components[0]).find((x: any) => x.custom_id === "slots");
  assert.equal(slotsInput.label, "Party 1 slots (one per line: Role - Weapon)");
  assert.equal(slotsInput.placeholder, "Tank - Axe");
  await d(form(`ccs2:${id}`, { slots2: "Healer - Holy" }, adminCta));
  await d(press(`cc:parties:${id}`, ["1"], adminCta));
  const back = (await getDraft(sql, id, NOW))!;
  assert.deepEqual([back.parties, back.slots2, back.slots2Text], [1, [], null]);
  assert.equal(((await d(press(`cc:parties:${id}`, ["3"], adminCta))) as any).data.flags, 64);
  const normal = (await open(d, undefined, "n")).id;
  assert.equal(((await d(press(`cc:parties:${normal}`, ["2"]))) as any).data.flags, 64, "normal content cannot have two parties");
});

test("the Party 2 button opens a form with one 1500-character box, filled with what is stored; valid lines are stored, bad lines are kept", async () => {
  const { d, sql } = await setup();
  const id = await ctaCard(d, sql);
  await d(press(`cc:parties:${id}`, ["2"], adminCta));
  const f: any = await d(press(`cc:p2:${id}`, undefined, adminCta));
  assert.equal(f.type, 9);
  assert.equal(f.data.custom_id, `ccs2:${id}`);
  assert.equal(f.data.components.length, 1);
  const input = f.data.components[0].components[0];
  assert.deepEqual([input.custom_id, input.max_length, input.label, input.placeholder], ["slots2", 1500, "Party 2 slots", "Tank - Axe"]);
  assert.deepEqual(modalProblems(f.data), []);
  let r: any = await d(form(`ccs2:${id}`, { slots2: "Healer - Holy\nDPS - Bow" }, adminCta));
  assert.equal(r.type, 7);
  let s = (await getDraft(sql, id, NOW))!;
  assert.deepEqual([s.slots2.map((x) => x.role), s.slots2Text], [["Healer", "DPS"], null]);
  assert.ok(say(r).includes("Party 2"));
  assert.equal((await d(press(`cc:p2:${id}`, undefined, adminCta)) as any).data.components[0].components[0].value, "Healer - Holy\nDPS - Bow");
  r = await d(form(`ccs2:${id}`, { slots2: "Heal" }, adminCta));
  s = (await getDraft(sql, id, NOW))!;
  assert.equal(s.slots2Text, "Heal");
  assert.ok(say(r).includes('Party 2, line 1: "Heal" is not a supported role.'));
  assert.equal((await d(press(`cc:p2:${id}`, undefined, adminCta)) as any).data.components[0].components[0].value, "Heal", "the typed text comes back to be fixed");
  const stranger = { member: { user: { id: OTHER }, roles: [] } };
  assert.ok(((await d(form(`ccs2:${id}`, { slots2: "Tank" }, stranger))) as any).data.content.includes("expired or is not yours"));
});

test("Copy party 1 duplicates the party 1 lines into party 2", async () => {
  const { d, sql } = await setup();
  const id = await ctaCard(d, sql);
  await d(press(`cc:parties:${id}`, ["2"], adminCta));
  await d(form(`ccd:${id}`, details, adminCta));
  const r: any = await d(press(`cc:copy:${id}`, undefined, adminCta));
  const s = (await getDraft(sql, id, NOW))!;
  assert.deepEqual(s.slots2.map((x) => [x.role, x.weapon]), [["Tank", "Mace"], ["Healer", ""]]);
  assert.ok(say(r).includes("Party 2"));
});

test("Create on a CTA lists a bad party 2 role and posts nothing; two valid parties are published with slots and slots2 as PvX, Other", async () => {
  const { d, sql, calls } = await setup();
  const id = await ctaCard(d, sql);
  await d(press(`cc:parties:${id}`, ["2"], adminCta));
  await d(form(`ccd:${id}`, details, adminCta));
  let r: any = await d(form(`ccs2:${id}`, { slots2: "Heal" }, adminCta));
  assert.ok(say(r).includes('Party 2, line 1: "Heal" is not a supported role. Use Tank, DTank, Healer, Support or DPS.'));
  assert.equal(btnOf(r, `cc:create:${id}`).disabled, true);
  r = await d(press(`cc:create:${id}`, undefined, adminCta));
  assert.ok(say(r).includes('Party 2, line 1: "Heal" is not a supported role.'));
  assert.equal(calls.length, 0);
  assert.equal((await sql`select count(*)::int as n from content`)[0]!.n, 0);
  await d(form(`ccs2:${id}`, { slots2: "Healer - Holy\nDPS - Bow" }, adminCta));
  r = await d(press(`cc:create:${id}`, undefined, adminCta));
  assert.ok(say(r).startsWith("✅ Created"), say(r));
  const [row] = await sql`select type, kind, cta from content`;
  assert.deepEqual([row!.type, row!.kind, row!.cta], ["pvx", "other", true]);
  const slots = await sql`select party, role from slot order by position`;
  assert.deepEqual(slots.map((s: any) => [s.party, s.role]), [[1, "Tank"], [1, "Healer"], [2, "Healer"], [2, "DPS"]]);
});

test("with two parties an empty party 1 or party 2 is a problem on the card; one party posts one roster", async () => {
  const { d, sql } = await setup();
  const id = await ctaCard(d, sql);
  await d(form(`ccd:${id}`, { ...details, slots: "" }, adminCta));
  await d(press(`cc:parties:${id}`, ["2"], adminCta));
  const r: any = await d(form(`ccs2:${id}`, { slots2: "Tank" }, adminCta));
  assert.ok(say(r).includes("Add the slots"), say(r));
  assert.equal(btnOf(r, `cc:create:${id}`).disabled, true);
  const r2: any = await d(press(`cc:parties:${id}`, ["1"], adminCta));
  assert.ok(say(r2).includes("Add the slots"));
});

test("a blank CTA ignores parties", async () => {
  const { d, sql } = await setup();
  const id = await ctaCard(d, sql);
  await d(press(`cc:parties:${id}`, ["2"], adminCta));
  const ok: any = await d(form(`ccl:${id}`, { title: "All hands", start: "2026-10-25 18:00", tier: "T8", notes: "" }, adminCta));
  assert.ok(say(ok).startsWith("✅ Created"), say(ok));
  assert.equal((await sql`select count(*)::int as n from slot`)[0]!.n, 0);
});

test("a preset saved from a two-party card loads both parties; an old preset loads as one party", async () => {
  const { d, sql } = await setup();
  const id = await ctaCard(d, sql);
  await d(press(`cc:parties:${id}`, ["2"], adminCta));
  await d(form(`ccd:${id}`, details, adminCta));
  await d(form(`ccs2:${id}`, { slots2: "DPS - Bow" }, adminCta));
  const saved: any = await d(form(`ccp:${id}`, { name: "Two parties" }, adminCta));
  assert.ok(say(saved).includes("Saved the preset"), say(saved));
  const [p] = await sql`select slots from slot_preset`;
  assert.deepEqual(p!.slots.map((s: any) => s.party ?? 1), [1, 1, 2]);
  await sql`insert into slot_preset (guild_id, name, slots, created_by) values (${GUILD}, 'Old', '[{"role":"Tank","weapon":"Mace"}]'::jsonb, 'o')`;
  const presets = await sql`select id, name from slot_preset`;
  const two = presets.find((x: any) => x.name === "Two parties")!.id, old = presets.find((x: any) => x.name === "Old")!.id;
  const fresh = await ctaCard(d, sql); // starts over
  const r: any = await d(press(`cc:preset:${fresh}`, [two], adminCta));
  let s = (await getDraft(sql, fresh, NOW))!;
  assert.deepEqual([s.parties, s.slots.map((x) => x.role), s.slots2.map((x) => x.role)], [2, ["Tank", "Healer"], ["DPS"]]);
  assert.ok(s.slots2.every((x) => x.party === undefined || x.party === 2));
  assert.deepEqual(discordProblems(r.data), []);
  await d(press(`cc:preset:${fresh}`, [old], adminCta));
  s = (await getDraft(sql, fresh, NOW))!;
  assert.deepEqual([s.parties, s.slots.length, s.slots2.length], [1, 1, 0]);
});

test("the CTA card with two parties and full slot lists stays within Discord's limits", async () => {
  const { d, sql } = await setup();
  const id = await ctaCard(d, sql);
  await d(press(`cc:parties:${id}`, ["2"], adminCta));
  const twenty = Array.from({ length: 20 }, (_, n) => `${["Tank", "Healer", "DPS", "Support", "DTank"][n % 5]} - Weapon number ${n}`).join("\n");
  await d(form(`ccd:${id}`, { ...details, slots: twenty }, adminCta));
  const r: any = await d(form(`ccs2:${id}`, { slots2: twenty }, adminCta));
  assert.deepEqual(discordProblems(r.data), []);
  assert.ok(say(r).includes("Party 1") && say(r).includes("Party 2"));
});
