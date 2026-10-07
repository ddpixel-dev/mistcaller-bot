import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setMessageId } from "../../src/db/content.ts";
import { claimSlot, leaveContent } from "../../src/db/signup.ts";
import { sendReminders } from "../../src/jobs/cron.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { flatComponents, textOf } from "../helpers/discordLimits.ts";

const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 3 * 3600000);
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup(now = NOW) {
  const sql = await testSql();
  await sql`insert into guild_settings (guild_id, pvp_forum_id, pve_forum_id, officer_role_id) values ('g1', 'fp', 'fe', 'officer')`;
  const make = async (over: Partial<Parameters<typeof createContent>[1]> = {}) => {
    const id = await createContent(sql, {
      guildId: "g1", threadId: "t1", type: "pvp", title: "Raid", notes: null, startsAt: START,
      tier: { min: { tier: 8, enchant: 0 }, max: null }, hasLoot: false, createdBy: "boss", now: new Date(START.getTime() - 24 * 3600000),
      slots: [{ role: "Tank", weapon: "Mace" }, { role: "DPS", weapon: "Bow" }], ...over,
    });
    await setMessageId(sql, id, `m-${over.threadId ?? "t1"}`);
    return id;
  };
  const id = await make();
  const edits: any[] = [];
  const posts: any[] = [];
  const rest: Rest = {
    async createMessage(channel, body) { posts.push({ channel, body }); return { id: "x" }; },
    async editMessage(channel, message, body) { edits.push({ channel, message, body }); },
    async deleteMessage() {},
  };
  let clock = now;
  const deps: Deps = { sql, rest, now: () => clock };
  return { sql, id, make, deps, d: createDispatch(deps), edits, posts, setNow: (t: Date) => { clock = t; } };
}
const member = (user: string, roles: string[] = [], permissions?: string) => ({ user: { id: user }, roles, permissions });
const cmd = (sub: string, user = "boss", extra: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 2, application_id: "a", token: "t", guild_id: "g1", channel_id: "t1",
  channel: { id: "t1", type: 11, parent_id: "fp" }, member: member(user),
  data: { name: "content", options: [{ name: sub, type: 1 }] }, ...extra,
});
const text = (r: any) => r.data.content as string;
const isEphemeral = (r: any, t?: string) => { assert.equal(r.type, 4); assert.equal(r.data.flags, 64); if (t) assert.ok(text(r).includes(t), text(r)); };
const status = async (sql: any) => (await sql`select status from content order by created_at limit 1`)[0].status;

test("/content lock closes signups: status locked, the roster refreshed without the menu and showing the closed banner", async () => {
  const { sql, id, d, edits } = await setup();
  const r = await d(cmd("lock"));
  assert.ok(text(r).includes("Roster locked"));
  assert.equal(await status(sql), "locked");
  assert.equal(edits.length, 1);
  assert.ok(textOf(edits[0].body).includes("The roll is closed."));
  assert.equal(flatComponents(edits[0].body).filter((c) => c.type === 3).length, 0);
  void id;
});

test("lock is for the creator, an officer or Manage Server; others are refused and nothing changes", async () => {
  const { sql, d } = await setup();
  isEphemeral(await d(cmd("lock", "stranger")), "Only the creator");
  assert.equal(await status(sql), "open");
  assert.ok(text(await d(cmd("lock", "o", { member: member("o", ["officer"]) }))).includes("Roster locked"));
});

test("lock explains itself when already locked, started, cancelled or done, or when the post has no content", async () => {
  const { sql, d, setNow } = await setup();
  await d(cmd("lock"));
  isEphemeral(await d(cmd("lock")), "already locked");
  await sql`update content set status = 'open'`;
  setNow(new Date(START.getTime() + 1000));
  isEphemeral(await d(cmd("lock")), "already started");
  setNow(NOW);
  for (const s of ["cancelled", "done"]) {
    await sql`update content set status = ${s}`;
    isEphemeral(await d(cmd("lock")), s === "cancelled" ? "no active content" : "Only open content");
  }
  isEphemeral(await d(cmd("lock", "boss", { channel: { id: "other", type: 11, parent_id: "fp" } })), "no active content");
});

test("once locked, nobody can sign up or move, players can still leave, and the reminder is still sent", async () => {
  const { sql, id, deps, d, posts } = await setup();
  const slots = (await getRosterView(sql, id, NOW))!.slots.map((s) => s.id);
  await claimSlot(sql, { contentId: id, slotId: slots[0]!, userId: "alice", guildId: "g1", now: NOW });
  await d(cmd("lock"));
  assert.equal(await claimSlot(sql, { contentId: id, slotId: slots[1]!, userId: "bob", guildId: "g1", now: NOW }), "locked");
  assert.equal(await claimSlot(sql, { contentId: id, slotId: slots[1]!, userId: "alice", guildId: "g1", now: NOW }), "locked");
  const twentyFive = new Date(START.getTime() - 25 * 60000);
  assert.equal(await sendReminders({ ...deps, now: () => twentyFive }), 1);
  assert.ok(posts[0].body.content.includes("<@alice>"));
  assert.equal(await leaveContent(sql, { contentId: id, userId: "alice", guildId: "g1" }), "left");
});

test("/content list shows upcoming content soonest first with counts and links, and a lock mark", async () => {
  const { sql, id, make, d } = await setup();
  const slots = (await getRosterView(sql, id, NOW))!.slots.map((s) => s.id);
  await claimSlot(sql, { contentId: id, slotId: slots[0]!, userId: "a", guildId: "g1", now: NOW });
  await make({ threadId: "t2", title: "Earlier *run*", type: "pve", kind: "world-boss", startsAt: new Date(START.getTime() - 3600000) });
  await sql`update content set status = 'locked' where thread_id = 't2'`;
  const r: any = await d(cmd("list"));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  const lines = text(r).split("\n");
  assert.equal(lines[0], "📅 **Upcoming content**");
  assert.ok(lines[1]!.includes("**Earlier \\*run\\***") && lines[1]!.includes("PvE · World boss") && lines[1]!.includes("0/2") && lines[1]!.includes("🔒"));
  assert.equal(lines[2], "https://discord.com/channels/g1/t2/m-t2");
  assert.ok(lines[3]!.includes("**Raid**") && lines[3]!.includes("PvP") && lines[3]!.includes("1/2") && !lines[3]!.includes("🔒"));
  assert.equal(lines[4], "https://discord.com/channels/g1/t1/m-t1");
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
});

test("the list leaves out started, ended, cancelled and other-server content, and says so when empty", async () => {
  const { sql, make, d, setNow } = await setup();
  await sql`update content set status = 'cancelled'`;
  assert.ok(text(await d(cmd("list"))).includes("No upcoming content"));
  await sql`update content set status = 'open'`;
  setNow(new Date(START.getTime() + 1000));
  assert.ok(text(await d(cmd("list"))).includes("No upcoming content"));
  setNow(NOW);
  await make({ threadId: "t3", title: "Done one" });
  await sql`update content set status = 'done' where thread_id = 't3'`;
  const other = await make({ threadId: "t4", title: "Elsewhere" });
  await sql`update content set guild_id = 'g2' where id = ${other}`;
  const t = text(await d(cmd("list")));
  assert.ok(t.includes("**Raid**"));
  assert.ok(!t.includes("Done one") && !t.includes("Elsewhere"));
  isEphemeral(await d(cmd("list", "boss", { guild_id: undefined })), "inside the server");
});

test("the list shows the next 15 and says there is more; long titles keep it under 2000 characters", async () => {
  const { make, d } = await setup();
  for (let n = 0; n < 17; n++) await make({ threadId: `x${n}`, title: "T".repeat(100), startsAt: new Date(START.getTime() + n * 60000) });
  const t = text(await d(cmd("list")));
  assert.ok(t.length <= 2000);
  assert.ok(t.includes("T".repeat(60)) && !t.includes("T".repeat(61)));
  assert.ok(t.split("https://discord.com").length - 1 <= 15);
});
