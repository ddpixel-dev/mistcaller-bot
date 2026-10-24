import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setMessageId } from "../../src/db/content.ts";
import { claimSlot } from "../../src/db/signup.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { discordProblems, flatComponents, plain, textOf } from "../helpers/discordLimits.ts";

const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 60 * 60000);
const [OWNER, A, STRANGER, ADMIN] = ["100000000000000001", "100000000000000002", "100000000000000005", "100000000000000006"];
const V2 = 1 << 15;
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup(now = NOW) {
  const sql = await testSql();
  await sql`insert into guild_admin_role (guild_id, role_id) values ('g1', 'admins')`;
  const id = await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvp", title: "Raid", notes: null, startsAt: START, tier: "T8", hasLoot: false, createdBy: OWNER, now: NOW,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }, { role: "DPS", weapon: "Bow" }],
  });
  await setMessageId(sql, id, "m1");
  const edits: any[] = [], posts: { channel: string; body: any }[] = [];
  const rest: Rest = {
    async createMessage(channel, body) { posts.push({ channel, body }); return { id: "x" }; },
    async editMessage(_c, _m, body) { edits.push(body); },
    async deleteMessage() {},
    async memberName(_g, u) { return `Name-${u.slice(-1)}`; },
  };
  const deps: Deps = { sql, rest, now: () => now };
  return { sql, id, d: createDispatch(deps), edits, posts };
}
const who = (id: string, roles: string[] = []) => ({ user: { id }, roles });
const ROSTER = { message: { id: "m1", flags: V2 } };
const PANEL = { message: { id: "p1", flags: 64 } };
const click = (customId: string, user: string, values?: unknown[], over: Partial<Interaction> = PANEL): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1", channel: { id: "t1", type: 11 }, member: who(user),
  data: { custom_id: customId, component_type: values ? 3 : 2, ...(values ? { values } : {}) }, ...over,
});
const text = (r: any) => String(r.data.content ?? "");
const labels = (r: any) => flatComponents(r.data).filter((c) => c.type === 2).map((c) => c.label);

test("Manage opens a private panel for the owner and admins only, with every host action", async () => {
  const { d, id } = await setup();
  assert.ok(text(await d(click(`mg:${id}`, STRANGER, undefined, ROSTER))).includes("Only the creator"));
  const r: any = await d(click(`mg:${id}`, OWNER, undefined, ROSTER));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.deepEqual(labels(r), ["Edit", "Sign up player", "Remove player", "Set duty", "Lock", "End", "Cancel", "Attendance"]);
  assert.deepEqual(discordProblems({ ...r.data, flags: 0 }), []);
  const ids = flatComponents(r.data).filter((c) => c.type === 2).map((c) => c.custom_id);
  assert.deepEqual(ids, [`mg:e:${id}`, `fa:${id}`, `rm:${id}`, `dt:${id}`, `mg:l:${id}`, `mg:n:${id}`, `mg:c:${id}`, `mg:a:${id}`]);
  const admin: any = await d(click(`mg:${id}`, ADMIN, undefined, { ...ROSTER, member: who(ADMIN, ["admins"]) }));
  assert.equal(admin.type, 4);
});

test("the panel offers Unlock on a locked roster, and nothing on finished or cancelled content", async () => {
  const { d, id, sql } = await setup();
  await sql`update content set status = 'locked'`;
  assert.ok(labels(await d(click(`mg:${id}`, OWNER, undefined, ROSTER))).includes("Unlock"));
  await sql`update content set status = 'done'`;
  assert.ok(text(await d(click(`mg:${id}`, OWNER, undefined, ROSTER))).includes("finished or cancelled"));
});

test("each panel button runs its command: lock, unlock, edit form, cancel confirmation, end and attendance rules", async () => {
  const { d, id, sql, edits } = await setup();
  assert.ok(text(await d(click(`mg:l:${id}`, STRANGER))).includes("Only the creator"));
  assert.ok(text(await d(click(`mg:l:${id}`, OWNER))).includes("Roster locked"));
  assert.equal((await sql`select status from content`)[0]!.status, "locked");
  assert.ok(edits.length > 0, "the roster was refreshed");
  assert.ok(text(await d(click(`mg:u:${id}`, OWNER))).includes("Roster unlocked"));
  const edit: any = await d(click(`mg:e:${id}`, OWNER));
  assert.equal(edit.type, 9, "the edit form opens");
  assert.equal(edit.data.custom_id, `edit:${id}:k`);
  const cancel: any = await d(click(`mg:c:${id}`, OWNER));
  assert.ok(flatComponents(cancel.data).some((c) => c.custom_id === `cancelyes:${id}`));
  assert.ok(text(await d(click(`mg:n:${id}`, OWNER))).includes("not started"));
  assert.ok(text(await d(click(`mg:a:${id}`, OWNER))).includes("not started"));
  assert.equal((await sql`select status from content`)[0]!.status, "open");
});

test("End works from the panel once the content has started", async () => {
  const { d, id, sql } = await setup(new Date(START.getTime() + 60000));
  assert.ok(text(await d(click(`mg:n:${id}`, OWNER))).includes("Content ended"));
  assert.equal((await sql`select status from content`)[0]!.status, "done");
});

test("a panel for content that is no longer the post's content, or a forged id, is refused", async () => {
  const { d, id, sql } = await setup();
  assert.ok(text(await d(click("mg:l:nope", OWNER))).includes("out of date"));
  assert.ok(text(await d(click(`mg:x:${id}`, OWNER))).includes("out of date"));
  assert.ok(text(await d(click(`mg:l:${id}`, OWNER, undefined, { ...PANEL, channel: { id: "t2", type: 11 } }))).includes("out of date"));
  assert.equal((await sql`select status from content`)[0]!.status, "open");
});

test("Set duty: a position, then a duty (Catcher included) or Clear; the roster shows it", async () => {
  const { d, id, sql, edits } = await setup();
  await claimSlot(sql, { contentId: id, slotId: (await getRosterView(sql, id, NOW))!.slots[2]!.id, userId: A, guildId: "g1", now: NOW });
  assert.ok(text(await d(click(`dt:${id}`, STRANGER))).includes("Only the creator"));
  const p: any = await d(click(`dt:${id}`, OWNER));
  assert.equal(p.type, 4);
  assert.equal(p.data.flags, 64);
  const positions = p.data.components[0].components[0];
  assert.equal(positions.custom_id, `dt:p:${id}`);
  assert.deepEqual(positions.options.map((o: any) => o.value), ["1", "2", "3"]);
  assert.deepEqual(discordProblems({ ...p.data, flags: 0 }), []);

  const picked: any = await d(click(`dt:p:${id}`, OWNER, ["3"]));
  assert.equal(picked.type, 7);
  const duties = picked.data.components.at(-1).components[0];
  assert.equal(duties.custom_id, `dt:d:${id}:3`);
  assert.deepEqual(duties.options.map((o: any) => o.label), ["Caller", "Scout", "Rat", "Looter", "Catcher", "Clear"]);
  assert.deepEqual(discordProblems({ ...picked.data, flags: 0 }), []);

  const done: any = await d(click(`dt:d:${id}:3`, OWNER, ["catcher"]));
  assert.equal(done.type, 7);
  assert.ok(done.data.content.includes("Catcher") && done.data.content.includes("position 3"));
  assert.equal((await sql`select duty from slot where position = 3`)[0]!.duty, "catcher");
  assert.ok(plain(textOf(edits.at(-1))).includes(`3. ⚔️ DPS - `) && plain(textOf(edits.at(-1))).includes("🪝 Catcher"));

  await d(click(`dt:d:${id}:3`, OWNER, ["none"]));
  assert.equal((await sql`select duty from slot where position = 3`)[0]!.duty, null);
  assert.ok(text(await d(click(`dt:d:${id}:3`, OWNER, ["captain"]))).includes("out of date"));
  assert.ok(text(await d(click(`dt:d:${id}:9`, OWNER, ["caller"]))).includes("no position 9"));
  assert.ok(text(await d(click(`dt:d:${id}:3`, STRANGER, ["caller"]))).includes("Only the creator"));
});
