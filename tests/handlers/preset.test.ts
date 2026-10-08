import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, setMessageId } from "../../src/db/content.ts";
import { listPresets, savePreset, MAX_PRESETS } from "../../src/db/preset.ts";
import { handlePresetCommand, handleAutocomplete } from "../../src/handlers/preset.ts";
import { handleCreateCommand } from "../../src/handlers/create.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";

const rest: Rest = { async createMessage() { return { id: "m" }; }, async editMessage() {}, async deleteMessage() {} };
const NOW = new Date("2026-10-06T12:00:00Z");
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup() {
  const sql = await testSql();
  await sql`insert into guild_admin_role (guild_id, role_id) values ('g1', 'officer')`;
  const id = await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvp", title: "Ganking", notes: null, startsAt: new Date("2026-12-01T18:00:00Z"),
    tier: { min: { tier: 8, enchant: 0 }, max: null }, hasLoot: false, createdBy: "boss",
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }],
  });
  await setMessageId(sql, id, "m1");
  const deps: Deps = { sql, rest, now: () => NOW };
  return { sql, deps, id };
}

const who = (userId: string, roles: string[] = [], permissions?: string) => ({ user: { id: userId }, roles, permissions });
const preset = (action: string, opts: Record<string, unknown> = {}, member = who("o", ["officer"]), type = 2): Interaction => ({
  id: "i", type, application_id: "a", token: "t", guild_id: "g1", channel_id: "t1",
  channel: { id: "t1", type: 11, parent_id: "fp" }, member,
  data: {
    name: "content",
    options: [{ name: "preset", type: 2, options: [{ name: action, type: 1, options: Object.entries(opts).map(([name, value]) => ({ name, type: 3, value })) }] }],
  },
});
const text = (r: any) => r.data.content as string;

test("an officer saves this post's slots as a preset; list shows it", async () => {
  const { deps, sql } = await setup();
  assert.ok(text(await handlePresetCommand(deps, preset("save", { name: "Ava raid" }))).includes('saved with 2 slots'));
  const all = await listPresets(sql, "g1");
  assert.deepEqual(all.map((p) => [p.name, p.slots]), [["Ava raid", [{ role: "Tank", weapon: "Mace", duty: null }, { role: "Healer", weapon: "Holy", duty: null }]]]);
  const list = text(await handlePresetCommand(deps, preset("list", {}, who("nobody"))));
  assert.ok(list.includes("Ava raid") && list.includes("1/25"));
});

test("Manage Server also may save; the creator and others may not", async () => {
  const { deps } = await setup();
  assert.ok(text(await handlePresetCommand(deps, preset("save", { name: "A" }, who("x", [], "32")))).includes("saved"));
  for (const m of [who("boss"), who("nobody")]) {
    assert.ok(text(await handlePresetCommand(deps, preset("save", { name: "B" }, m))).includes("Manage Server or an admin role"));
    assert.ok(text(await handlePresetCommand(deps, preset("delete", { name: "A" }, m))).includes("Manage Server or an admin role"));
  }
});

test("names are unique per guild ignoring case, trimmed, length limited", async () => {
  const { deps } = await setup();
  await handlePresetCommand(deps, preset("save", { name: "Ava Raid" }));
  assert.ok(text(await handlePresetCommand(deps, preset("save", { name: "  ava raid " }))).includes("already exists"));
  assert.ok(text(await handlePresetCommand(deps, preset("save", { name: "   " }))).includes("needs a name"));
  assert.ok(text(await handlePresetCommand(deps, preset("save", { name: "x".repeat(51) }))).includes("too long"));
});

test("a server holds at most 25 presets", async () => {
  const { deps, sql } = await setup();
  for (let n = 0; n < MAX_PRESETS; n++) {
    assert.equal(await savePreset(sql, { guildId: "g1", name: `p${n}`, slots: [{ role: "R", weapon: "W" }], createdBy: "o" }), "ok");
  }
  assert.ok(text(await handlePresetCommand(deps, preset("save", { name: "one more" }))).includes("25 presets"));
});

test("saving outside a post with content is refused; delete works and reports a missing name", async () => {
  const { deps } = await setup();
  const elsewhere = { ...preset("save", { name: "X" }), channel: { id: "other", type: 11, parent_id: "fp" } } as Interaction;
  assert.ok(text(await handlePresetCommand(deps, elsewhere)).includes("inside a post that has content"));
  await handlePresetCommand(deps, preset("save", { name: "Ava" }));
  assert.equal(text(await handlePresetCommand(deps, preset("delete", { name: "ava" }))), "Preset deleted.");
  assert.ok(text(await handlePresetCommand(deps, preset("delete", { name: "ava" }))).includes("no preset"));
});

test("presets are per guild", async () => {
  const { deps, sql } = await setup();
  await handlePresetCommand(deps, preset("save", { name: "Ava" }));
  assert.equal((await listPresets(sql, "g2")).length, 0);
  assert.ok(text(await handlePresetCommand(deps, { ...preset("list"), guild_id: "g2" } as Interaction)).includes("No presets"));
});

test("the create panel lists presets; picking one fills the slots box; clearing it empties the choice", async () => {
  const { deps, sql, id } = await setup();
  await handlePresetCommand(deps, preset("save", { name: "Ava" }));
  await sql`update content set status = 'cancelled' where id = ${id}`;
  const [{ id: presetId }] = await sql`select id from slot_preset`;
  const base: Interaction = {
    id: "i", type: 2, application_id: "a", token: "t", guild_id: "g1", channel_id: "t1",
    channel: { id: "t1", type: 11, parent_id: "fp" }, member: who("u1"),
    data: { name: "content", options: [{ name: "create", type: 1 }] },
  };
  const panel: any = await handleCreateCommand(deps, base);
  const presetMenu = panel.data.components[3].components[0];
  assert.equal(presetMenu.custom_id, "cp:preset:-:-:-:-");
  assert.equal(presetMenu.min_values, 0);
  assert.deepEqual(presetMenu.options.map((o: any) => [o.label, o.value]), [["Ava", presetId]]);
  const press = (customId: string, values?: unknown[]): Interaction => ({
    ...base, type: 3, data: { custom_id: customId, component_type: values ? 3 : 2, ...(values ? { values } : {}) },
  });
  const d = createDispatch(deps);
  const picked: any = await d(press("cp:preset:pvp:0:other:-", [presetId]));
  assert.equal(picked.data.components[4].components[0].custom_id, `cpgo:pvp:0:other:${presetId}`);
  const form: any = await d(press(`cpgo:pvp:0:other:${presetId}`));
  assert.equal(form.type, 9);
  const slotsInput = form.data.components.map((row: any) => row.components[0]).find((c: any) => c.custom_id === "slots");
  assert.equal(slotsInput.value, "Tank - Mace\nHealer - Holy");
  const cleared: any = await d(press(`cp:preset:pvp:0:other:${presetId}`, []));
  assert.equal(cleared.data.components[4].components[0].custom_id, "cpgo:pvp:0:other:-");
  assert.ok(text(await d(press("cp:preset:pvp:0:other:-", ["00000000-0000-4000-8000-000000000000"]))).includes("out of date"));
  await handlePresetCommand(deps, preset("delete", { name: "Ava" }));
  assert.ok(text(await d(press(`cpgo:pvp:0:other:${presetId}`))).includes("no longer exists"));
});

test("autocomplete filters the guild's names and answers with type 8", async () => {
  const { deps } = await setup();
  await handlePresetCommand(deps, preset("save", { name: "Ava raid" }));
  await handlePresetCommand(deps, preset("save", { name: "Roam" }));
  const ac = (name: string, value: string): Interaction => ({
    id: "i", type: 4, application_id: "a", token: "t", guild_id: "g1",
    member: who("u1"),
    data: {
      name: "content",
      options: [{ name: "preset", type: 2, options: [{ name: "delete", type: 1, options: [{ name, type: 3, value, focused: true }] }] }],
    },
  });
  const r: any = await createDispatch(deps)(ac("name", "av"));
  assert.equal(r.type, 8);
  assert.deepEqual(r.data.choices, [{ name: "Ava raid", value: "Ava raid" }]);
  assert.deepEqual(((await handleAutocomplete(deps, ac("name", "")) ) as any).data.choices.map((c: any) => c.name), ["Ava raid", "Roam"]);
  assert.deepEqual(((await handleAutocomplete(deps, ac("title", "av")) ) as any).data.choices, []);
  assert.deepEqual(((await handleAutocomplete(deps, ac("name", "%")) ) as any).data.choices, []);
});
