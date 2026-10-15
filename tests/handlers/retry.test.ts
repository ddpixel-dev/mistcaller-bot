import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setMessageId } from "../../src/db/content.ts";
import { purgeDrafts } from "../../src/db/draft.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const GUILD = "100000000000000001";
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup() {
  const sql = await testSql();
  const posts: any[] = [];
  const rest: Rest = {
    async createMessage(_c, body) { posts.push(body); return { id: "msg-1" }; },
    async editMessage() {},
    async deleteMessage() {},
  };
  const deps: Deps = { sql, rest, now: () => NOW };
  return { sql, deps, posts, d: createDispatch(deps) };
}
const who = (id: string) => ({ user: { id }, roles: [] as string[], permissions: "0" });
const submit = (customId: string, values: Record<string, string>, user = "boss"): Interaction => ({
  id: "i", type: 5, application_id: "a", token: "t", guild_id: GUILD, channel: { id: "c1", type: 0 }, member: who(user),
  data: { custom_id: customId, components: Object.entries(values).map(([custom_id, value]) => ({ type: 1, components: [{ type: 4, custom_id, value }] })) },
});
const press = (customId: string, user = "boss"): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: GUILD, channel: { id: "c1", type: 0 }, member: who(user),
  data: { custom_id: customId, component_type: 2 },
});
const good = { title: "Ava raid", start: "2026-10-07 18:00", tier: "Weapon T7.1 - Gear T4.3", slots: "Tank\nHealer - Holy Staff", notes: "bring food" };
const bad = { ...good, title: "", start: "yesterday", slots: "Tank - Nonsense Weapon (Captain)" };
const retryId = (r: any) => r.data.components[0].components[0].custom_id as string;

test("a create form with mistakes lists all of them at once and offers Fix and retry; nothing is created", async () => {
  const { d, sql, posts } = await setup();
  const r: any = await d(submit("create:pvp:0:other", bad));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  const text = String(r.data.content);
  assert.match(text, /mistakes/);
  assert.ok((text.match(/^• /gm) ?? []).length >= 3, text);
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
  const button = r.data.components[0].components[0];
  assert.equal(button.label, "Fix and retry");
  assert.match(button.custom_id, /^rt:[0-9a-f-]{36}$/);
  assert.equal((await sql`select 1 from content`).length, 0);
  assert.equal(posts.length, 0);
});

test("Fix and retry reopens the same form with everything the member typed, keeping its id", async () => {
  const { d } = await setup();
  const failed: any = await d(submit("create:pvp:0:other", bad));
  const r: any = await d(press(retryId(failed)));
  assert.equal(r.type, 9);
  assert.equal(r.data.custom_id, "create:pvp:0:other");
  const fields = Object.fromEntries(r.data.components.map((row: any) => [row.components[0].custom_id, row.components[0].value]));
  assert.equal(fields.start, "yesterday");
  assert.equal(fields.slots, bad.slots);
  assert.equal(fields.notes, "bring food");
  assert.equal("value" in r.data.components[0].components[0], false, "an empty title is left empty");
  assert.equal(r.data.components[4].components[0].required, false);
  const again: any = await d(submit(r.data.custom_id, good));
  assert.match(String(again.data.content), /Created|created/);
});

test("a new failure replaces the old retry; another member, a stranger id and an expired retry get a short answer", async () => {
  const { d, deps, sql } = await setup();
  const first: any = await d(submit("create:pvp:0:other", bad));
  const second: any = await d(submit("create:pvp:0:other", { ...bad, title: "Second try" }));
  assert.equal((await sql`select 1 from form_retry`).length, 1);
  assert.equal(retryId(first), retryId(second), "one row per member and post");
  const reopened: any = await d(press(retryId(first)));
  assert.equal(reopened.data.components[0].components[0].value, "Second try", "the latest text is what comes back");
  assert.match(String((await d(press(retryId(second), "other-member")) as any).data.content), /no longer kept/);
  assert.match(String((await d(press("rt:not-an-id")) as any).data.content), /no longer kept/);
  const late = createDispatch({ ...deps, now: () => new Date(NOW.getTime() + 61 * 60000) });
  assert.match(String((await late(press(retryId(second))) as any).data.content), /no longer kept/);
  assert.equal((await d(press(retryId(second))) as any).type, 9);
});

test("the edit form has the same flow: all mistakes at once, then Fix and retry reopens it filled in with the edit id", async () => {
  const { d, deps, sql } = await setup();
  const id = await createContent(sql, {
    guildId: GUILD, threadId: "c1", type: "pvp", title: "Raid", notes: null, startsAt: new Date("2026-12-01T18:00:00Z"), tier: "T8", hasLoot: false,
    createdBy: "boss", slots: [{ role: "Tank", weapon: "Mace" }],
  });
  await setMessageId(sql, id, "m1");
  const failed: any = await d(submit(`edit:${id}:k`, { title: "Raid", start: "tomorrow-ish", tier: "", slots: "Tank - Mace", notes: "" }));
  assert.match(String(failed.data.content), /2 mistakes|mistakes/);
  assert.equal((await getRosterView(deps.sql, id, NOW))!.tier, "T8", "nothing changed");
  const r: any = await d(press(retryId(failed)));
  assert.equal(r.type, 9);
  assert.equal(r.data.custom_id, `edit:${id}:k`);
  assert.equal(r.data.title, "Edit content");
  const fixed: any = await d(submit(r.data.custom_id, { title: "Raid", start: "2026-12-01 19:00", tier: "T8.1", slots: "Tank - Mace", notes: "" }));
  assert.ok(!String(fixed.data.content).includes("mistake"), String(fixed.data.content));
  assert.equal((await getRosterView(deps.sql, id, NOW))!.tier, "T8.1");
});

test("held-slot removal in the edit form also offers Fix and retry", async () => {
  const { d, sql } = await setup();
  const id = await createContent(sql, {
    guildId: GUILD, threadId: "c1", type: "pvp", title: "Raid", notes: null, startsAt: new Date("2026-12-01T18:00:00Z"), tier: "T8", hasLoot: false,
    createdBy: "boss", slots: [{ role: "Tank", weapon: "Mace" }, { role: "DPS", weapon: "Bow" }],
  });
  await setMessageId(sql, id, "m1");
  const slots = (await getRosterView(sql, id, NOW))!.slots;
  await sql`insert into signup (content_id, slot_id, user_id, guild_id, status) values (${id}, ${slots[1]!.id}, 'p1', ${GUILD}, 'signed')`;
  const r: any = await d(submit(`edit:${id}:k`, { title: "Raid", start: "2026-12-01 18:00", tier: "T8", slots: "Tank - Mace", notes: "" }));
  assert.equal(r.data.components[0].components[0].label, "Fix and retry");
});

test("old retries are purged with the old drafts", async () => {
  const { d, sql } = await setup();
  await d(submit("create:pvp:0:other", bad));
  assert.equal(await purgeDrafts(sql, new Date(NOW.getTime() + 30 * 60000)), 0);
  assert.equal(await purgeDrafts(sql, new Date(NOW.getTime() + 61 * 60000)), 1);
  assert.equal((await sql`select 1 from form_retry`).length, 0);
});
