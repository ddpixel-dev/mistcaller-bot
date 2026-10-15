import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent } from "../../src/db/content.ts";
import { getDashboard, setDashboardChannel } from "../../src/db/dashboard.ts";
import { refreshAllDashboards, refreshDashboard, refreshDashboardSoon } from "../../src/jobs/dashboards.ts";
import { DiscordApiError, type Rest } from "../../src/discord/rest.ts";
import type { Deps } from "../../src/discord/dispatch.ts";

const NOW = new Date("2026-10-15T12:00:00Z");
const H = 3600000;
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

type Calls = { created: { channel: string; body: any }[]; edited: { channel: string; message: string; body: any }[]; deleted: { channel: string; message: string }[] };
function fakeRest(opts: { editError?: () => Error | undefined; createError?: () => Error | undefined; delay?: number } = {}) {
  const calls: Calls = { created: [], edited: [], deleted: [] };
  let next = 0;
  const rest: Rest = {
    async createMessage(channel, body) {
      if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
      const e = opts.createError?.(); if (e) throw e;
      calls.created.push({ channel, body }); return { id: `m${++next}` };
    },
    async editMessage(channel, message, body) { const e = opts.editError?.(); if (e) throw e; calls.edited.push({ channel, message, body }); },
    async deleteMessage(channel, message) { calls.deleted.push({ channel, message }); },
  };
  return { rest, calls };
}
async function setup(rest: Rest, now = NOW) {
  const sql = await testSql();
  await setDashboardChannel(sql, { guildId: "g1", kind: "schedule", channelId: "ch1", now });
  const deps: Deps = { sql, rest, now: () => now };
  const add = (n: number, startsAt = new Date(NOW.getTime() + (n + 1) * H), guildId = "g1") => createContent(sql, {
    guildId, threadId: `t${guildId}-${n}`, type: "pvp", title: `Event ${n}`, notes: null, startsAt, tier: "T8", hasLoot: false,
    createdBy: "boss", now: NOW, slots: [{ role: "Tank", weapon: "Mace" }],
  });
  return { sql, deps, add };
}
const stateOf = async (sql: any) => (await getDashboard(sql, "g1", "schedule"))!;

test("the first refresh posts the message and remembers it; the same schedule again changes nothing", async () => {
  const { rest, calls } = fakeRest();
  const { deps, sql, add } = await setup(rest);
  await add(1);
  assert.equal(await refreshDashboard(deps, "g1", "schedule"), "updated");
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0]!.channel, "ch1");
  assert.deepEqual((await stateOf(sql)).messageIds, ["m1"]);
  assert.equal(await refreshDashboard(deps, "g1", "schedule"), "unchanged");
  assert.equal(calls.created.length + calls.edited.length, 1, "no second call");
});

test("a changed schedule edits the same message in place", async () => {
  const { rest, calls } = fakeRest();
  const { deps, add } = await setup(rest);
  await add(1);
  await refreshDashboard(deps, "g1", "schedule");
  await add(2);
  assert.equal(await refreshDashboard(deps, "g1", "schedule"), "updated");
  assert.equal(calls.created.length, 1);
  assert.equal(calls.edited.length, 1);
  assert.deepEqual([calls.edited[0]!.channel, calls.edited[0]!.message], ["ch1", "m1"]);
});

test("beyond 12 events a second message is posted, and it is deleted again when the events drop", async () => {
  const { rest, calls } = fakeRest();
  const { deps, sql, add } = await setup(rest);
  const ids: string[] = [];
  for (let n = 1; n <= 14; n++) ids.push(await add(n));
  await refreshDashboard(deps, "g1", "schedule");
  assert.equal(calls.created.length, 2);
  assert.deepEqual((await stateOf(sql)).messageIds, ["m1", "m2"]);
  await sql`update content set status = 'cancelled' where id = any(${ids.slice(5)})`;
  assert.equal(await refreshDashboard(deps, "g1", "schedule"), "updated");
  assert.deepEqual(calls.deleted, [{ channel: "ch1", message: "m2" }]);
  assert.deepEqual((await stateOf(sql)).messageIds, ["m1"]);
});

test("a message deleted by hand is posted again", async () => {
  let gone = true;
  const { rest, calls } = fakeRest({ editError: () => (gone ? new DiscordApiError(404, "Unknown Message") : undefined) });
  const { deps, sql, add } = await setup(rest);
  await add(1);
  await refreshDashboard(deps, "g1", "schedule");
  await add(2);
  assert.equal(await refreshDashboard(deps, "g1", "schedule"), "updated");
  assert.equal(calls.created.length, 2, "the edit found no message, so a new one was posted");
  assert.deepEqual((await stateOf(sql)).messageIds, ["m2"]);
  gone = false;
});

test("when the bot cannot post, nothing is remembered and nothing throws; the next refresh tries again", async () => {
  let fail = true;
  const { rest, calls } = fakeRest({ createError: () => (fail ? new DiscordApiError(403, "Missing Access") : undefined) });
  const { deps, sql, add } = await setup(rest);
  await add(1);
  assert.equal(await refreshDashboard(deps, "g1", "schedule"), "failed");
  assert.deepEqual(await stateOf(sql).then((s) => [s.messageIds, s.digest]), [[], ""]);
  fail = false;
  assert.equal(await refreshDashboard(deps, "g1", "schedule"), "updated");
  assert.equal(calls.created.length, 1);
});

test("a server without a schedule channel does nothing; other servers' events never appear", async () => {
  const { rest, calls } = fakeRest();
  const { deps, add } = await setup(rest);
  assert.equal(await refreshDashboard(deps, "g9", "schedule"), "none");
  await add(1, undefined, "g2");
  await refreshDashboard(deps, "g1", "schedule");
  assert.ok(!JSON.stringify(calls.created[0]!.body).includes("Event 1"));
});

test("two refreshes at once post each message only once", async () => {
  const { rest, calls } = fakeRest({ delay: 50 });
  const { deps, add } = await setup(rest);
  await add(1);
  await Promise.all([refreshDashboard(deps, "g1", "schedule"), refreshDashboard(deps, "g1", "schedule")]);
  assert.equal(calls.created.length, 1);
});

test("the quick refresh used after a command never throws and never waits longer than its limit", async () => {
  const { rest } = fakeRest({ delay: 1000 });
  const { deps, add } = await setup(rest);
  await add(1);
  const started = Date.now();
  await refreshDashboardSoon(deps, "g1", "schedule", 100);
  assert.ok(Date.now() - started < 600, `${Date.now() - started} ms`);
  const broken = fakeRest({ createError: () => new Error("boom") });
  await refreshDashboardSoon({ ...deps, rest: broken.rest }, "g1", "schedule", 500);
});

test("the scheduled job refreshes every server's schedule and reports how many messages changed", async () => {
  const { rest } = fakeRest();
  const { deps, sql, add } = await setup(rest);
  await add(1);
  await setDashboardChannel(sql, { guildId: "g2", kind: "schedule", channelId: "ch2", now: NOW });
  assert.equal(await refreshAllDashboards(deps), 2, "both servers got their first message");
  assert.equal(await refreshAllDashboards(deps), 0, "nothing changed since");
});

test("the statistics dashboard posts one message with the numbers, and the scheduled job refreshes it only every 30 minutes", async () => {
  const { rest, calls } = fakeRest();
  const { deps, sql, add } = await setup(rest);
  await add(1);
  await setDashboardChannel(sql, { guildId: "g1", kind: "statistics", channelId: "ch9", now: NOW });
  assert.equal(await refreshDashboard(deps, "g1", "statistics"), "updated");
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0]!.channel, "ch9");
  assert.ok(JSON.stringify(calls.created[0]!.body).includes("Statistics"));
  await add(2);
  assert.equal(await refreshAllDashboards({ ...deps, now: () => new Date(NOW.getTime() + 10 * 60000) }), 1, "the schedule changed; statistics are not due yet");
  const stats = await getDashboard(sql, "g1", "statistics");
  assert.equal(stats!.updatedAt.getTime(), NOW.getTime());
  assert.equal(await refreshAllDashboards({ ...deps, now: () => new Date(NOW.getTime() + 31 * 60000) }), 1, "statistics are due and their numbers changed");
  assert.equal(await refreshAllDashboards({ ...deps, now: () => new Date(NOW.getTime() + 70 * 60000) }), 0, "due again but nothing changed");
  assert.equal((await getDashboard(sql, "g1", "statistics"))!.updatedAt.getTime(), NOW.getTime() + 70 * 60000, "the check is remembered");
});
