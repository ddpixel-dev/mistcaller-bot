import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { handleSetupCommand } from "../../src/handlers/setup.ts";
import { getAdminRoleIds, setAdminRoles } from "../../src/db/settings.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { discordProblems } from "../helpers/discordLimits.ts";

const rest: Rest = { async createMessage() { return { id: "m" }; }, async editMessage() {}, async deleteMessage() {} };
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

const GUILD = "100000001";
const deps = async (): Promise<Deps> => ({ sql: await testSql(), rest, now: () => new Date("2026-10-08T12:00:00Z") });
const setup = (permissions = "32", over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 2, application_id: "a", token: "t", guild_id: GUILD, channel_id: "c",
  member: { user: { id: "u1" }, roles: [], permissions },
  data: { name: "content", options: [{ name: "setup", type: 1 }] },
  ...over,
});
const pick = (values: unknown, permissions = "32", over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: GUILD, channel_id: "c",
  member: { user: { id: "u1" }, roles: [], permissions },
  data: { custom_id: "setup:roles", component_type: 6, values },
  ...over,
});
const select = (r: any) => r.data.components[0].components[0];

test("setup opens a private role picker with the current admin roles already selected", async () => {
  const d = await deps();
  await setAdminRoles(d.sql, GUILD, ["200000001", "200000002"]);
  const r: any = await handleSetupCommand(d, setup());
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
  assert.equal(select(r).type, 6);
  assert.equal(select(r).custom_id, "setup:roles");
  assert.equal(select(r).min_values, 0);
  assert.equal(select(r).max_values, 10);
  assert.deepEqual(select(r).default_values.map((v: any) => v.id).sort(), ["200000001", "200000002"]);
  assert.ok(select(r).default_values.every((v: any) => v.type === "role"));
  assert.ok(r.data.content.includes("<@&200000001>"));
  assert.deepEqual(discordProblems(r.data), []);
});

test("with no admin roles yet the panel says so and the picker is empty", async () => {
  const r: any = await handleSetupCommand(await deps(), setup());
  assert.ok(r.data.content.includes("none yet"));
  assert.deepEqual(select(r).default_values, []);
});

test("picking roles saves the whole set and refreshes the panel in place", async () => {
  const d = await deps();
  const dispatch = createDispatch(d);
  const r: any = await dispatch(pick(["200000001", "200000003"]));
  assert.equal(r.type, 7);
  assert.deepEqual((await getAdminRoleIds(d.sql, GUILD)).sort(), ["200000001", "200000003"]);
  assert.deepEqual(select(r).default_values.map((v: any) => v.id).sort(), ["200000001", "200000003"]);
  const r2: any = await dispatch(pick(["200000003"]));
  assert.deepEqual(await getAdminRoleIds(d.sql, GUILD), ["200000003"]);
  assert.equal(r2.type, 7);
  const none: any = await dispatch(pick([]));
  assert.deepEqual(await getAdminRoleIds(d.sql, GUILD), []);
  assert.ok(none.data.content.includes("none yet"));
});

test("setup and its picker are for Manage Server or Administrator only; nothing changes otherwise", async () => {
  const d = await deps();
  const dispatch = createDispatch(d);
  await setAdminRoles(d.sql, GUILD, ["200000001"]);
  for (const permissions of ["0", "1024", ""]) {
    const a: any = await dispatch(setup(permissions));
    assert.equal(a.data.flags, 64);
    assert.ok(a.data.content.includes("Manage Server"));
    assert.equal(a.data.components, undefined);
    const b: any = await dispatch(pick(["200000009"], permissions));
    assert.ok(b.data.content.includes("Manage Server"));
  }
  assert.ok(((await dispatch(setup("8"))) as any).data.components);
  assert.deepEqual(await getAdminRoleIds(d.sql, GUILD), ["200000001"]);
});

test("a forged picker click is refused: @everyone, too many roles, garbage values, wrong id or no server", async () => {
  const d = await deps();
  const dispatch = createDispatch(d);
  await setAdminRoles(d.sql, GUILD, ["200000001"]);
  const text = (r: any) => r.data.content as string;
  assert.ok(text(await dispatch(pick([GUILD]))).includes("@everyone"));
  assert.ok(text(await dispatch(pick(Array.from({ length: 11 }, (_, n) => `30000000${n}0`)))).includes("at most 10"));
  assert.ok(text(await dispatch(pick(["abc"]))).includes("not valid"));
  assert.ok(text(await dispatch(pick([42]))).includes("not valid"));
  assert.ok(text(await dispatch(pick("200000009" as unknown))).includes("not valid"));
  assert.ok(text(await dispatch(pick(undefined))).includes("not valid"));
  assert.ok(text(await dispatch(pick(["200000009"], "32", { guild_id: undefined }))).includes("not valid"));
  assert.ok(text(await dispatch(pick(["200000009"], "32", { data: { custom_id: "setup:other", values: ["200000009"] } }))).includes("not valid"));
  assert.deepEqual(await getAdminRoleIds(d.sql, GUILD), ["200000001"]);
});

test("setup never affects another server's roles", async () => {
  const d = await deps();
  await setAdminRoles(d.sql, "999", ["200000077"]);
  await createDispatch(d)(pick(["200000001"]));
  assert.deepEqual(await getAdminRoleIds(d.sql, "999"), ["200000077"]);
});
