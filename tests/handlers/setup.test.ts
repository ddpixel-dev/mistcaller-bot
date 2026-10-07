import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { handleSetupCommand } from "../../src/handlers/setup.ts";
import { getGuildSettings } from "../../src/db/settings.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";

const rest: Rest = { async createMessage() { return { id: "m" }; }, async editMessage() {}, async deleteMessage() {} };
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

const deps = async (): Promise<Deps> => ({ sql: await testSql(), rest, now: () => new Date("2026-10-07T12:00:00Z") });
const setup = (options: { name: string; type: number; value: unknown }[], permissions = "32", over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 2, application_id: "a", token: "t", guild_id: "100000001", channel_id: "c",
  member: { user: { id: "u1" }, roles: [], permissions },
  data: { name: "content", options: [{ name: "setup", type: 1, options }] },
  ...over,
});
const opt = (name: string, value: unknown, type = 7) => ({ name, type, value });
const text = (r: any) => r.data.content as string;

test("first setup needs both forums", async () => {
  const d = await deps();
  assert.ok(text(await handleSetupCommand(d, setup([opt("pvp-forum", "200000001")]))).includes("needs both forums"));
  assert.equal(await getGuildSettings(d.sql, "100000001"), null);
});

test("first setup with both forums saves and shows the settings", async () => {
  const d = await deps();
  const r = await handleSetupCommand(d, setup([opt("pvp-forum", "200000001"), opt("pve-forum", "200000002"), opt("officer-role", "300000001", 8), opt("daily-cap", 7, 4)]));
  assert.ok(text(r).includes("Setup saved."));
  assert.ok(text(r).includes("<#200000001>") && text(r).includes("<@&300000001>") && text(r).includes("cap: 7"));
  assert.deepEqual(await getGuildSettings(d.sql, "100000001"), {
    guildId: "100000001", officerRoleId: "300000001", pvpForumId: "200000001", pveForumId: "200000002", dailyCap: 7,
  });
  assert.deepEqual((r as any).data.allowed_mentions, { parse: [] });
});

test("later setup changes only the given options", async () => {
  const d = await deps();
  await handleSetupCommand(d, setup([opt("pvp-forum", "200000001"), opt("pve-forum", "200000002"), opt("officer-role", "300000001", 8)]));
  await handleSetupCommand(d, setup([opt("pve-forum", "200000009")]));
  const s = (await getGuildSettings(d.sql, "100000001"))!;
  assert.equal(s.pvpForumId, "200000001");
  assert.equal(s.pveForumId, "200000009");
  assert.equal(s.officerRoleId, "300000001");
  assert.equal(s.dailyCap, 5);
});

test("the same forum for both types is refused and nothing is saved", async () => {
  const d = await deps();
  assert.ok(text(await handleSetupCommand(d, setup([opt("pvp-forum", "200000001"), opt("pve-forum", "200000001")]))).includes("different"));
  assert.equal(await getGuildSettings(d.sql, "100000001"), null);
});

test("only Manage Server or Administrator may run setup", async () => {
  const d = await deps();
  const noPerms = await handleSetupCommand(d, setup([opt("pvp-forum", "200000001")], "32", { member: { user: { id: "u1" }, roles: [] } }));
  assert.ok(text(noPerms).includes("Manage Server"));
  for (const permissions of ["0", "1024"]) {
    assert.ok(text(await handleSetupCommand(d, setup([opt("pvp-forum", "200000001"), opt("pve-forum", "200000002")], permissions))).includes("Manage Server"));
  }
  assert.equal(await getGuildSettings(d.sql, "100000001"), null);
  assert.ok(text(await handleSetupCommand(d, setup([opt("pvp-forum", "200000001"), opt("pve-forum", "200000002")], "8"))).includes("Setup saved."));
});

test("invalid ids and caps are refused", async () => {
  const d = await deps();
  assert.ok(text(await handleSetupCommand(d, setup([opt("pvp-forum", "x'; drop table content;--"), opt("pve-forum", "200000002")]))).includes("not valid"));
  assert.ok(text(await handleSetupCommand(d, setup([opt("pvp-forum", "200000001"), opt("pve-forum", "200000002"), opt("daily-cap", 0, 4)]))).includes("1 to 50"));
  assert.ok(text(await handleSetupCommand(d, setup([opt("pvp-forum", "200000001"), opt("pve-forum", "200000002"), opt("daily-cap", 2.5, 4)]))).includes("1 to 50"));
  assert.equal(await getGuildSettings(d.sql, "100000001"), null);
});

test("outside a server it is refused, and dispatch routes setup", async () => {
  const d = await deps();
  assert.ok(text(await handleSetupCommand(d, setup([], "32", { guild_id: undefined }))).includes("inside the server"));
  const r = await createDispatch(d)(setup([opt("pvp-forum", "200000001"), opt("pve-forum", "200000002")]));
  assert.ok(text(r).includes("Setup saved."));
});
