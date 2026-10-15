import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView } from "../../src/db/content.ts";
import { claimSlot } from "../../src/db/signup.ts";
import { deleteDashboard, getDashboard, listDashboards, saveDashboardState, setDashboardChannel } from "../../src/db/dashboard.ts";
import { listSchedule } from "../../src/db/schedule.ts";

const NOW = new Date("2026-10-15T12:00:00Z");
const H = 3600000;
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

test("a dashboard row holds the channel, the message ids and the last digest; a new channel starts empty", async () => {
  const sql = await testSql();
  assert.equal(await getDashboard(sql, "g1", "schedule"), null);
  await setDashboardChannel(sql, { guildId: "g1", kind: "schedule", channelId: "c1", now: NOW });
  await saveDashboardState(sql, { guildId: "g1", kind: "schedule", messageIds: ["m1", "m2"], digest: "abc", now: NOW });
  const d = (await getDashboard(sql, "g1", "schedule"))!;
  assert.deepEqual([d.channelId, d.messageIds, d.digest], ["c1", ["m1", "m2"], "abc"]);
  await setDashboardChannel(sql, { guildId: "g1", kind: "schedule", channelId: "c2", now: NOW });
  const moved = (await getDashboard(sql, "g1", "schedule"))!;
  assert.deepEqual([moved.channelId, moved.messageIds, moved.digest], ["c2", [], ""]);
  await setDashboardChannel(sql, { guildId: "g1", kind: "statistics", channelId: "c3", now: NOW });
  await setDashboardChannel(sql, { guildId: "g2", kind: "schedule", channelId: "c4", now: NOW });
  assert.deepEqual((await listDashboards(sql, "schedule")).map((x) => x.guildId), ["g1", "g2"]);
  await deleteDashboard(sql, "g1", "schedule");
  assert.equal(await getDashboard(sql, "g1", "schedule"), null);
  assert.ok(await getDashboard(sql, "g1", "statistics"), "the other kind stays");
});

test("the schedule lists open and locked events that started or start within 7 days, soonest first, per server", async () => {
  const sql = await testSql();
  const make = (threadId: string, startsAt: Date, over: Record<string, unknown> = {}) => createContent(sql, {
    guildId: "g1", threadId, type: "pvp", title: threadId, notes: null, startsAt, tier: "T8", hasLoot: false, createdBy: "boss", now: NOW,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "DPS", weapon: "Bow" }, { role: "DPS", weapon: "Bow" }], ...over,
  });
  const live = await make("live", new Date(NOW.getTime() - 2 * H));
  const soon = await make("soon", new Date(NOW.getTime() + 3 * H));
  const week = await make("week", new Date(NOW.getTime() + 6 * 24 * H));
  await make("far", new Date(NOW.getTime() + 8 * 24 * H));
  const done = await make("done", new Date(NOW.getTime() - 5 * H));
  const cancelled = await make("cancelled", new Date(NOW.getTime() + H));
  const locked = await make("locked", new Date(NOW.getTime() + 2 * H));
  await make("other", new Date(NOW.getTime() + H), { guildId: "g2" });
  await sql`update content set status = 'done' where id = ${done}`;
  await sql`update content set status = 'cancelled' where id = ${cancelled}`;
  await sql`update content set status = 'locked' where id = ${locked}`;
  const events = await listSchedule(sql, "g1", NOW);
  assert.deepEqual(events.map((e) => e.title), ["live", "locked", "soon", "week"]);
  assert.equal(events[1]!.status, "locked");
  void live; void soon; void week;
});

test("the schedule's party count is seated players plus reserved fills, like the roster", async () => {
  const sql = await testSql();
  const id = await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pve", title: "Dungeon", notes: null, startsAt: new Date(NOW.getTime() + H), tier: "T8", hasLoot: false,
    createdBy: "boss", now: NOW, slots: [{ role: "Tank", weapon: "Mace" }, { role: "DPS", weapon: "Bow" }, { role: "DPS", weapon: "Bow" }],
  });
  const slot = (await getRosterView(sql, id, NOW))!.slots[0]!.id;
  await claimSlot(sql, { contentId: id, slotId: slot, userId: "a", guildId: "g1", now: NOW });
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status) values ('g1', ${id}, 'f1', null, 'fill'), ('g1', ${id}, 'f2', null, 'fill'), ('g1', ${id}, 'f3', null, 'fill')`;
  const [e] = await listSchedule(sql, "g1", NOW);
  assert.deepEqual([e!.party, e!.total], [3, 3], "1 seated + min(3 fills, 2 open)");
});
