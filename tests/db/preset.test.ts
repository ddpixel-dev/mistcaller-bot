import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { MAX_PRESETS, listPresets, savePreset, updatePreset } from "../../src/db/preset.ts";

beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

const slots = [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy", duty: null }];
const save = async (name: string, over: Partial<{ guildId: string; slots: typeof slots }> = {}) =>
  savePreset(await testSql(), { guildId: "g1", name, slots, createdBy: "o", ...over });

test("a preset is saved per server and listed by name", async () => {
  assert.equal(await save("Roam"), "ok");
  assert.equal(await save("Ava raid"), "ok");
  const sql = await testSql();
  assert.deepEqual((await listPresets(sql, "g1")).map((p) => p.name), ["Ava raid", "Roam"]);
  assert.equal((await listPresets(sql, "g2")).length, 0);
});

test("saving a name that exists, in any case, replaces its slots", async () => {
  await save("Ava Raid");
  assert.equal(await save("  ava raid".trim(), { slots: [{ role: "DPS", weapon: "Bow" }] }), "replaced");
  const all = await listPresets(await testSql(), "g1");
  assert.deepEqual(all.map((p) => [p.name, p.slots]), [["Ava Raid", [{ role: "DPS", weapon: "Bow" }]]]);
});

test("a server holds at most 25 presets, but an existing one can still be replaced", async () => {
  for (let n = 0; n < MAX_PRESETS; n++) assert.equal(await save(`p${n}`), "ok");
  assert.equal(await save("one more"), "full");
  assert.equal(await save("P3"), "replaced");
  assert.equal((await listPresets(await testSql(), "g1")).length, MAX_PRESETS);
});

test("slots keep their party; a preset saved before parties has none and reads as party 1", async () => {
  const sql = await testSql();
  await save("Two", { slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy", party: 2 }] as any });
  await sql`insert into slot_preset (guild_id, name, slots, created_by) values ('g1', 'Old', '[{"role":"Tank","weapon":"Mace"}]'::jsonb, 'o')`;
  const all = await listPresets(sql, "g1");
  assert.deepEqual(all.find((p) => p.name === "Two")!.slots.map((s) => s.party ?? 1), [1, 2]);
  assert.deepEqual(all.find((p) => p.name === "Old")!.slots.map((s) => s.party ?? 1), [1]);
});

// FR-078: Edit preset updates one preset by id.
test("updatePreset changes the name, slots and settings of that preset only", async () => {
  const sql = await testSql();
  await save("Roam");
  await save("Ava");
  const [roam] = (await listPresets(sql, "g1")).filter((p) => p.name === "Roam");
  const settings = { type: "pve" as const, kind: "tracking", loot: true, selection: false, title: "Hunt", tier: "T6", notes: null, buildRef: null, bombers: null, slotMode: "role" as const };
  assert.equal(await updatePreset(sql, { guildId: "g1", id: roam!.id, name: "Roam 2", slots: [{ role: "DPS", weapon: "Bow" }], settings, createdBy: "o2", cta: false }), "ok");
  const all = await listPresets(sql, "g1");
  assert.deepEqual(all.map((p) => [p.name, p.slots.length]), [["Ava", 2], ["Roam 2", 1]]);
  assert.deepEqual(all.find((p) => p.name === "Roam 2")!.settings, settings);
  assert.equal(all.find((p) => p.name === "Roam 2")!.id, roam!.id, "the same preset, renamed");
});

test("updatePreset refuses a name another preset uses (either kind), allows its own name in other capitals, and says when it is gone", async () => {
  const sql = await testSql();
  await save("Roam");
  await savePreset(sql, { guildId: "g1", name: "Big CTA", slots, createdBy: "o", cta: true });
  const roam = (await listPresets(sql, "g1")).find((p) => p.name === "Roam")!;
  const base = { guildId: "g1", id: roam.id, slots, settings: null, createdBy: "o", cta: false };
  assert.equal(await updatePreset(sql, { ...base, name: "big cta" }), "name_taken");
  assert.equal(await updatePreset(sql, { ...base, name: "ROAM" }), "ok");
  assert.equal(await updatePreset(sql, { ...base, guildId: "g2", name: "X" }), "gone", "another server's preset");
  assert.equal(await updatePreset(sql, { ...base, cta: true, name: "X" }), "gone", "the other kind");
  await sql`delete from slot_preset where id = ${roam.id}`;
  assert.equal(await updatePreset(sql, { ...base, name: "X" }), "gone");
  assert.equal((await listPresets(sql, "g1")).length, 0);
});

test("FR-076: preset settings keep the slot mode; older settings read as role mode", async () => {
  const { toSettings } = await import("../../src/db/preset.ts");
  assert.equal(toSettings({ type: "pvp" })!.slotMode, "role");
  assert.equal(toSettings({ type: "pvp", slotMode: "weapon" })!.slotMode, "weapon");
  assert.equal(toSettings({ type: "pvp", slotMode: "nonsense" })!.slotMode, "role");
});
