import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { handleSetupCommand } from "../../src/handlers/setup.ts";
import { setAdminRoles } from "../../src/db/settings.ts";
import { getDashboard } from "../../src/db/dashboard.ts";
import { DiscordApiError, type Rest } from "../../src/discord/rest.ts";
import type { Deps } from "../../src/discord/dispatch.ts";
import type { Interaction } from "../../src/discord/types.ts";

const NOW = new Date("2026-10-15T12:00:00Z");
const GUILD = "100000001";
const CH1 = "300000000000000001", CH2 = "300000000000000002", VOICE = "300000000000000003";
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

function fake(opts: { createFails?: boolean } = {}) {
  const created: { channel: string; body: any }[] = [], deleted: { channel: string; message: string }[] = [];
  let n = 0;
  const rest: Rest = {
    async createMessage(channel, body) {
      if (opts.createFails) throw new DiscordApiError(403, "Missing Access");
      created.push({ channel, body }); return { id: `m${++n}` };
    },
    async editMessage() {},
    async deleteMessage(channel, message) { deleted.push({ channel, message }); },
  };
  return { rest, created, deleted };
}
const deps = async (rest: Rest): Promise<Deps> => ({ sql: await testSql(), rest, now: () => NOW });
const channels = { [CH1]: { id: CH1, type: 0 }, [CH2]: { id: CH2, type: 5 }, [VOICE]: { id: VOICE, type: 2 } };
const setup = (options: unknown[] = [], over: { permissions?: string; roles?: string[] } = {}): Interaction => ({
  id: "i", type: 2, application_id: "a", token: "t", guild_id: GUILD, channel_id: "c",
  member: { user: { id: "u1" }, roles: over.roles ?? [], permissions: over.permissions ?? "0" },
  data: { name: "content", options: [{ name: "setup", type: 1, options }], resolved: { channels } },
});
const opt = (name: string, value: unknown, type = 7) => ({ name, type, value });
const text = (r: any) => String(r.data.content);

test("an admin sets the calendar channel: the calendar is posted there at once and remembered", async () => {
  const { rest, created } = fake();
  const d = await deps(rest);
  const r: any = await handleSetupCommand(d, setup([opt("calendar-channel", CH1)], { permissions: "32" }));
  assert.equal(r.data.flags, 64);
  assert.ok(text(r).includes(`<#${CH1}>`) && text(r).toLowerCase().includes("calendar"));
  assert.equal(created.length, 1);
  assert.equal(created[0]!.channel, CH1);
  assert.ok(JSON.stringify(created[0]!.body).includes("Events Calendar"));
  assert.deepEqual((await getDashboard(d.sql, GUILD, "schedule"))!.messageIds, ["m1"]);
});

test("an admin role may set the calendar channel too; an ordinary member may not, and nothing is posted", async () => {
  const { rest, created } = fake();
  const d = await deps(rest);
  await setAdminRoles(d.sql, GUILD, ["200000001"]);
  assert.ok(text(await handleSetupCommand(d, setup([opt("calendar-channel", CH1)], { roles: ["200000001"] }))).includes(`<#${CH1}>`));
  const refused: any = await handleSetupCommand(d, setup([opt("calendar-channel", CH2)], { roles: ["999"] }));
  assert.ok(text(refused).includes("Only an admin"));
  assert.equal((await getDashboard(d.sql, GUILD, "schedule"))!.channelId, CH1, "the refused change did nothing");
  assert.equal(created.length, 1);
});

test("the admin roles panel still needs Manage Server itself", async () => {
  const { rest } = fake();
  const d = await deps(rest);
  await setAdminRoles(d.sql, GUILD, ["200000001"]);
  assert.ok(text(await handleSetupCommand(d, setup([], { roles: ["200000001"] }))).includes("Manage Server"));
});

test("only text and announcement channels are accepted", async () => {
  const { rest, created } = fake();
  const d = await deps(rest);
  for (const value of [VOICE, "300000000000000099", "not-an-id"]) {
    const r: any = await handleSetupCommand(d, setup([opt("calendar-channel", value)], { permissions: "32" }));
    assert.ok(text(r).includes("text or announcement channel"), value);
  }
  assert.equal(created.length, 0);
  assert.equal(await getDashboard(d.sql, GUILD, "schedule"), null);
});

test("if the bot cannot post there, the channel is not saved and the reply explains what to give the bot", async () => {
  const { rest } = fake({ createFails: true });
  const d = await deps(rest);
  const r: any = await handleSetupCommand(d, setup([opt("calendar-channel", CH1)], { permissions: "32" }));
  assert.ok(text(r).includes("View Channel") && text(r).includes("Send Messages"));
  assert.equal(await getDashboard(d.sql, GUILD, "schedule"), null);
});

test("moving the channel removes the bot's old messages; clear-calendar removes them and the setting", async () => {
  const { rest, created, deleted } = fake();
  const d = await deps(rest);
  await handleSetupCommand(d, setup([opt("calendar-channel", CH1)], { permissions: "32" }));
  await handleSetupCommand(d, setup([opt("calendar-channel", CH2)], { permissions: "32" }));
  assert.deepEqual(deleted, [{ channel: CH1, message: "m1" }]);
  assert.equal(created.length, 2);
  assert.equal((await getDashboard(d.sql, GUILD, "schedule"))!.channelId, CH2);
  const cleared: any = await handleSetupCommand(d, setup([opt("clear-calendar", true, 5)], { permissions: "32" }));
  assert.ok(text(cleared).toLowerCase().includes("calendar"));
  assert.deepEqual(deleted.at(-1), { channel: CH2, message: "m2" });
  assert.equal(await getDashboard(d.sql, GUILD, "schedule"), null);
});

test("a channel together with its clear option is refused", async () => {
  const { rest } = fake();
  const d = await deps(rest);
  const r: any = await handleSetupCommand(d, setup([opt("calendar-channel", CH1), opt("clear-calendar", true, 5)], { permissions: "32" }));
  assert.ok(text(r).includes("not both"));
});

test("the setup panel shows the channels now in use", async () => {
  const { rest } = fake();
  const d = await deps(rest);
  await handleSetupCommand(d, setup([opt("calendar-channel", CH1)], { permissions: "32" }));
  const panel: any = await handleSetupCommand(d, setup([], { permissions: "32" }));
  assert.ok(text(panel).includes(`Calendar channel: <#${CH1}>`) && !text(panel).includes("Statistics"));
});
