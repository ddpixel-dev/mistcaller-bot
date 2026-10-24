import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { getDraft } from "../../src/db/draft.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { discordProblems, flatComponents, plain, textOf } from "../helpers/discordLimits.ts";
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
  };
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
const idOf = (r: any) => r.data.components.at(-1).components[0].custom_id.split(":")[2] as string;
const details = { title: "Ava roam", start: "2026-10-25 18:00", tier: "T8", slots: "Tank - Mace\nHealer", notes: "" };

async function open(d: any, over: Partial<Interaction> = {}) {
  const r: any = await d(command("create", [], over));
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
  assert.ok(kind.options.some((o: any) => o.value === "zvz") && !kind.options.some((o: any) => o.value === "mists"));
  r = await d(press(`cc:kind:${id}`, ["zvz"]));
  assert.ok(r.data.content.startsWith("## 🏰"), "the card's heading shows the category's icon");
  r = await d(press(`cc:type:${id}`, ["pve"]));
  kind = menus(r)[1];
  assert.ok(kind.options.some((o: any) => o.value === "mists") && !kind.options.some((o: any) => o.value === "zvz"));
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
  assert.equal(inputs[1].value, "2026-10-24 13:00", "the start is prefilled");
  const r: any = await d(form(`ccd:${id}`, { ...details, slots: "Tank - Mace (Captain)" }));
  assert.equal(r.type, 7);
  assert.ok(r.data.content.includes("Ava roam") && r.data.content.includes("Unknown duty"));
  let stored = (await getDraft(sql, id, NOW))!;
  assert.deepEqual([stored.title, stored.startText, stored.gearTier, stored.notes, stored.slotsText], ["Ava roam", "2026-10-25 18:00", "T8", null, "Tank - Mace (Captain)"]);
  const again: any = await d(press(`cc:details:${id}`));
  assert.equal(again.data.components[3].components[0].value, "Tank - Mace (Captain)", "the typed slots come back to be fixed");
  await d(form(`ccd:${id}`, details));
  stored = (await getDraft(sql, id, NOW))!;
  assert.deepEqual([stored.slots.length, stored.slotsText], [2, null]);
});

test("Create lists every problem on the card and creates nothing; only the member who opened the card can use it", async () => {
  const { d, sql, calls } = await setup();
  const { id } = await open(d);
  const r: any = await d(press(`cc:create:${id}`));
  assert.equal(r.type, 7);
  for (const p of ["Pick the type", "Add a title", "gear tier", "Add the slots"]) assert.ok(r.data.content.includes(p), p);
  assert.equal((await sql`select count(*)::int as n from content`)[0]!.n, 0);
  assert.equal(calls.length, 0);
  const stranger = { member: { user: { id: OTHER }, roles: [] } };
  for (const i of [press(`cc:create:${id}`, undefined, stranger), press(`cc:type:${id}`, ["pvp"], stranger), form(`ccd:${id}`, details, stranger)]) {
    assert.ok(((await d(i)) as any).data.content.includes("expired or is not yours"));
  }
});

test("Create in a channel posts the roster there, removes the draft and links it", async () => {
  const { d, sql, calls } = await setup();
  const { id } = await open(d);
  await d(press(`cc:type:${id}`, ["pvp"]));
  await d(form(`ccd:${id}`, details));
  const r: any = await d(press(`cc:create:${id}`));
  assert.equal(r.data.content, `✅ Created: https://discord.com/channels/${GUILD}/c1/m1`);
  assert.equal(calls.filter((c) => c.op === "createMessage").length, 1);
  const [row] = await sql`select thread_id, message_id, own_post, title from content`;
  assert.deepEqual([row!.thread_id, row!.message_id, row!.own_post, row!.title], ["c1", "m1", false, "Ava roam"]);
  assert.equal(await getDraft(sql, id, NOW), null);
});

// ---- event forums (FR-053) ----

const forumOpt = (name: string, value: string) => ({ name, type: 7, value });
const resolvedForum = { channels: { [FORUM]: { id: FORUM, type: 15 } } };
const setupForum = (d: any, type?: string) =>
  d(command("setup", [forumOpt("event-forum", FORUM), ...(type ? [{ name: "forum-type", type: 3, value: type }] : [])], {}, resolvedForum));

test("setup event-forum posts and pins a Create event post, remembers the forum and lists the permissions to set", async () => {
  const { d, sql, calls } = await setup();
  const r: any = await setupForum(d, "pvp");
  assert.equal(r.data.flags, 64);
  assert.ok(r.data.content.includes("Create Posts") && r.data.content.includes("Manage Threads"));
  const post = calls.find((c) => c.op === "createForumPost")!;
  assert.equal(post.args[0], FORUM);
  assert.equal(post.args[1].name, "📌 Create an event");
  assert.deepEqual(flatComponents(post.args[1].message).find((c) => c.type === 2)!.custom_id, "lc:create");
  assert.deepEqual(calls.find((c) => c.op === "editChannel")!.args, ["post1", { flags: 2 }], "pinned");
  const [row] = await sql`select forum_id, type, launcher_thread_id from event_forum`;
  assert.deepEqual([row!.forum_id, row!.type, row!.launcher_thread_id], [FORUM, "pvp", "post1"]);
  await setupForum(d);
  assert.ok(calls.some((c) => c.op === "deleteChannel" && c.args[0] === "post1"), "the old launcher is replaced");
  assert.equal((await sql`select type from event_forum`)[0]!.type, null, "Any by default");
  const cleared: any = await d(command("setup", [forumOpt("clear-event-forum", FORUM)], {}, resolvedForum));
  assert.ok(cleared.data.content.includes("no longer an event forum"));
  assert.equal((await sql`select count(*)::int as n from event_forum`)[0]!.n, 0);
});

test("setup event-forum is for admins and forums only, and reports a forum the bot cannot post in", async () => {
  const { d, sql } = await setup({ failPost: true });
  assert.ok(((await d(command("setup", [forumOpt("event-forum", FORUM)], { member: { user: { id: OTHER }, roles: [] } }, resolvedForum))) as any).data.content.includes("Only an admin"));
  assert.ok(((await d(command("setup", [forumOpt("event-forum", "c1")], {}, { channels: { c1: { type: 0 } } }))) as any).data.content.includes("forum channel"));
  const r: any = await setupForum(d);
  assert.ok(r.data.content.includes("could not create") && r.data.content.includes("Create Posts"));
  assert.equal((await sql`select count(*)::int as n from event_forum`)[0]!.n, 0);
});

async function launcherCard(d: any, type?: string) {
  await setupForum(d, type);
  const inPost = { channel: { id: "post1", type: 11, parent_id: FORUM } };
  const r: any = await d(press("lc:create", undefined, inPost));
  return { r, id: idOf(r), inPost };
}

test("Create event opens the card in the launcher post; a PvP forum offers PvP and PvX; the command is refused there", async () => {
  const { d } = await setup();
  const { r, inPost } = await launcherCard(d, "pvp");
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.deepEqual(menus(r)[0].options.map((o: any) => o.value), ["pvp", "pvx"]);
  assert.ok(((await d(command("create", [], inPost))) as any).data.content.includes("Create event"));
  assert.ok(((await d(press("lc:create", undefined, { channel: { id: "elsewhere", type: 11 } }))) as any).data.content.includes("no longer set up"));
});

test("Create from a launcher makes a new post named after the title, with matching tags, the roster as its first message", async () => {
  const { d, sql, calls } = await setup();
  const { id, inPost } = await launcherCard(d);
  await d(press(`cc:type:${id}`, ["pvp"], inPost));
  await d(press(`cc:kind:${id}`, ["zvz"], inPost));
  await d(form(`ccd:${id}`, details, inPost));
  const r: any = await d(press(`cc:create:${id}`, undefined, inPost));
  assert.equal(r.data.content, `✅ Created: https://discord.com/channels/${GUILD}/post2/post2`);
  const post = calls.filter((c) => c.op === "createForumPost").at(-1)!;
  assert.deepEqual([post.args[0], post.args[1].name, post.args[1].applied_tags], [FORUM, "Ava roam", ["tag-pvp", "tag-zvz"]]);
  const edit = calls.filter((c) => c.op === "editMessage").at(-1)!;
  assert.deepEqual(edit.args.slice(0, 2), ["post2", "post2"], "the post's first message becomes the roster");
  assert.ok(plain(textOf(edit.args[2])).includes("Ava roam"));
  assert.deepEqual(discordProblems(edit.args[2]), []);
  const [row] = await sql`select thread_id, message_id, own_post from content`;
  assert.deepEqual([row!.thread_id, row!.message_id, row!.own_post], ["post2", "post2", true]);
});

test("when the roster cannot be put in the new post, the post and the content are removed", async () => {
  const { d, sql, calls } = await setup({ failEdit: true });
  const { id, inPost } = await launcherCard(d);
  await d(press(`cc:type:${id}`, ["pve"], inPost));
  await d(form(`ccd:${id}`, details, inPost));
  const r: any = await d(press(`cc:create:${id}`, undefined, inPost));
  assert.equal(r.data.flags, 64);
  assert.ok(calls.some((c) => c.op === "deleteChannel" && c.args[0] === "post2"));
  assert.equal((await sql`select count(*)::int as n from content`)[0]!.n, 0);
  assert.ok(await getDraft(sql, id, NOW), "the card is kept to try again");
});

test("editing the title renames a post the bot made; a refused rename is explained; other posts are never renamed", async () => {
  for (const renameFails of [false, true]) {
    await resetDb(await testSql());
    const { d, deps, sql, calls } = await setup({ renameFails });
    const { id, inPost } = await launcherCard(d);
    await d(press(`cc:type:${id}`, ["pvp"], inPost));
    await d(form(`ccd:${id}`, details, inPost));
    await d(press(`cc:create:${id}`, undefined, inPost));
    const [{ id: contentId }] = await sql`select id from content`;
    const edit = (title: string) => handleEditModal(deps, form(`edit:${contentId}:k`, { ...details, title }, { channel: { id: "post2", type: 11, parent_id: FORUM } }));
    const r: any = await edit("Ava roam 2");
    const renames = calls.filter((c) => c.op === "editChannel" && c.args[1].name);
    assert.deepEqual(renames.map((c) => c.args), [["post2", { name: "Ava roam 2" }]]);
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
