import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, setMessageId } from "../../src/db/content.ts";
import { setDashboardChannel } from "../../src/db/dashboard.ts";
import { refreshDashboard } from "../../src/jobs/dashboards.ts";
import { runJobs } from "../../src/jobs/cron.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import { withHostActions } from "../helpers/host.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";

const START = new Date("2026-10-15T18:00:00Z");
const NOW = new Date("2026-10-15T12:00:00Z");
const GUILD = "100000000000000001";
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup(withDashboard = true) {
  const sql = await testSql();
  const dash: { edits: any[]; created: any[] } = { edits: [], created: [] };
  const rest: Rest = {
    async createMessage(channel, body) { if (channel === "dash") { dash.created.push(body); return { id: "dm1" }; } return { id: "roster1" }; },
    async editMessage(channel, _m, body) { if (channel === "dash") dash.edits.push(body); },
    async deleteMessage() {},
  };
  const now = { t: NOW };
  const deps: Deps = { sql, rest, now: () => now.t };
  const id = await createContent(sql, {
    guildId: GUILD, threadId: "t1", type: "pvp", title: "Original", notes: null, startsAt: START, tier: "T8", hasLoot: false, createdBy: "boss", now: NOW,
    slots: [{ role: "Tank", weapon: "Mace" }],
  });
  await setMessageId(sql, id, "m1");
  if (withDashboard) {
    await setDashboardChannel(sql, { guildId: GUILD, kind: "schedule", channelId: "dash", now: NOW });
    await refreshDashboard(deps, GUILD, "schedule");
    dash.created.length = 0;
  }
  return { sql, deps, d: withHostActions(createDispatch(deps), deps), id, dash, now };
}
const who = { user: { id: "boss" }, roles: [] as string[], permissions: "0" };
const cmd = (sub: string): Interaction => ({
  id: "i", type: 2, application_id: "a", token: "t", guild_id: GUILD, channel_id: "t1", channel: { id: "t1", type: 11 }, member: who,
  data: { name: "content", options: [{ name: sub, type: 1 }] },
});
const press = (customId: string): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: GUILD, channel: { id: "t1", type: 11 }, member: who,
  message: { id: "m1", flags: 1 << 15 }, data: { custom_id: customId, component_type: 2 },
});
const submit = (customId: string, values: Record<string, string>): Interaction => ({
  id: "i", type: 5, application_id: "a", token: "t", guild_id: GUILD, channel: { id: "t1", type: 11 }, member: who,
  data: { custom_id: customId, components: Object.entries(values).map(([custom_id, value]) => ({ type: 1, components: [{ type: 4, custom_id, value }] })) },
});
const shown = (dash: { edits: any[] }) => JSON.stringify(dash.edits.at(-1) ?? "");

test("cancelling an event removes it from the calendar at once", async () => {
  const { d, id, dash } = await setup();
  await d(press(`cancelyes:${id}`));
  assert.equal(dash.edits.length, 1);
  assert.ok(!shown(dash).includes("Original"));
});

test("editing an event updates the calendar at once", async () => {
  const { d, id, dash } = await setup();
  const r: any = await d(submit(`edit:${id}:k`, { title: "Renamed", start: "2026-10-15 19:00", tier: "T8", slots: "Tank - Mace", notes: "" }));
  assert.ok(!String(r.data.content).includes("mistake"), String(r.data.content));
  assert.equal(dash.edits.length, 1);
  assert.ok(shown(dash).includes("Renamed") && shown(dash).includes("19:00"));
});

test("ending an event removes it, and reopening brings it back", async () => {
  const { d, dash, now } = await setup();
  now.t = new Date(START.getTime() + 10 * 60000);
  await d(cmd("end"));
  assert.equal(dash.edits.length, 1);
  assert.ok(!shown(dash).includes("Original"));
  await d(cmd("reopen"));
  assert.equal(dash.edits.length, 2);
  assert.ok(shown(dash).includes("Original"));
});

test("creating an event adds it to the calendar at once", async () => {
  const { d, dash, sql } = await setup();
  await sql`delete from content`;
  await refreshDashboard({ sql, rest: { async createMessage() { return { id: "x" }; }, async editMessage(_c, _m, b) { dash.edits.push(b); }, async deleteMessage() {} }, now: () => NOW }, GUILD, "schedule");
  dash.edits.length = 0;
  const made: any = await d(submit("create:pvp:0:other", { title: "Brand new", start: "2026-10-16 18:00", tier: "T8", slots: "Tank - Mace", notes: "" }));
  assert.match(String(made.data.content), /Created|created/);
  assert.equal(dash.edits.length, 1);
  assert.ok(shown(dash).includes("Brand new"));
});

test("without a calendar channel the commands behave as before and call Discord only for the roster", async () => {
  const { d, id, dash } = await setup(false);
  await d(press(`cancelyes:${id}`));
  assert.equal(dash.edits.length + dash.created.length, 0);
});

test("the scheduled job also refreshes the calendar and reports how many dashboards changed", async () => {
  const { deps, dash, sql } = await setup();
  await sql`update content set title = 'Changed in the database'`;
  const out = await runJobs(deps);
  assert.equal(out.dashboards, 1);
  assert.ok(shown(dash).includes("Changed in the database"));
  assert.equal((await runJobs(deps)).dashboards, 0);
});
