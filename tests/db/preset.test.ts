import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { MAX_PRESETS, listPresets, savePreset } from "../../src/db/preset.ts";

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
