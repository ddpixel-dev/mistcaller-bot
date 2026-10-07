import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWeapons, searchWeapons, weaponIconUrl, type Weapon } from "../../src/domain/weapons.ts";
import { WEAPONS } from "../../src/data/weapons.ts";

const sample = `   1: UNIQUE_HIDEOUT                                                   : Hideout Construction Kit
   2: T3_2H_TOOL_TRACKING                                              : Journeyman's Tracking Toolkit
   3: T4_MAIN_SWORD                                                    : Adept's Broadsword
   4: T4_MAIN_SWORD@1                                                  : Adept's Broadsword
   5: T5_MAIN_SWORD                                                    : Expert's Broadsword
   6: T4_2H_GREATAXE                                                   : Adept's Greataxe
   7: T2_OFF_SHIELD                                                    : Novice's Shield
   8: T3_OFF_SHIELD                                                    : Journeyman's Shield
   9: T4_ARMOR_PLATE_SET1                                              : Adept's Soldier Armor
  10: T4_2H_KNUCKLES_SET1                                              : Adept's Brawler Gloves
garbage line`;

test("parseWeapons keeps weapons, drops tools, enchants and non-weapons, and strips the tier word", () => {
  const w = parseWeapons(sample);
  assert.deepEqual(w.map((x) => x.base), ["2H_GREATAXE", "2H_KNUCKLES_SET1", "MAIN_SWORD", "OFF_SHIELD"].sort((a, b) => {
    const name = (id: string) => w.find((x) => x.base === id)!.name;
    return name(a).localeCompare(name(b));
  }));
  const sword = w.find((x) => x.base === "MAIN_SWORD")!;
  assert.deepEqual(sword, { base: "MAIN_SWORD", name: "Broadsword", slot: "main", iconTier: 4 });
  assert.equal(w.find((x) => x.base === "OFF_SHIELD")!.iconTier, 2);
  assert.equal(w.find((x) => x.base === "2H_GREATAXE")!.slot, "2h");
  assert.ok(!w.some((x) => /TOOL|ARMOR|@/.test(x.base)));
});

const list: Weapon[] = [
  { base: "MAIN_ARCANESTAFF", name: "Arcane Staff", slot: "main", iconTier: 4 },
  { base: "2H_GREATAXE", name: "Greataxe", slot: "2h", iconTier: 4 },
  { base: "MAIN_AXE", name: "Battleaxe", slot: "main", iconTier: 4 },
  { base: "2H_HALBERD", name: "Halberd", slot: "2h", iconTier: 4 },
  { base: "MAIN_HOLYSTAFF", name: "Holy Staff", slot: "main", iconTier: 4 },
];

test("search needs every word, ranks names that start with the text first, ignores case and accents", () => {
  assert.deepEqual(searchWeapons(list, "axe").map((w) => w.name), ["Battleaxe", "Greataxe"]);
  assert.deepEqual(searchWeapons(list, "a").map((w) => w.name), ["Arcane Staff", "Battleaxe", "Greataxe", "Halberd", "Holy Staff"]);
  assert.deepEqual(searchWeapons(list, "HOLY sta").map((w) => w.name), ["Holy Staff"]);
  assert.deepEqual(searchWeapons(list, "hölý").map((w) => w.name), ["Holy Staff"]);
  assert.deepEqual(searchWeapons(list, "   "), []);
  assert.deepEqual(searchWeapons(list, "zzz"), []);
  assert.equal(searchWeapons(list, "a", 2).length, 2);
  assert.equal(searchWeapons(list, "a", 2)[0]!.name, "Arcane Staff");
});

test("icon url uses the tiered id and the size", () => {
  assert.equal(weaponIconUrl(list[1]!), "https://render.albiononline.com/v1/item/T4_2H_GREATAXE.png?size=64");
  assert.equal(weaponIconUrl({ ...list[1]!, iconTier: 2 }, 128), "https://render.albiononline.com/v1/item/T2_2H_GREATAXE.png?size=128");
});

test("the generated data is sane: enough weapons, unique, valid ids, names fit a slot line", () => {
  assert.ok(WEAPONS.length >= 150, `only ${WEAPONS.length}`);
  assert.equal(new Set(WEAPONS.map((w) => w.base)).size, WEAPONS.length);
  assert.equal(new Set(WEAPONS.map((w) => w.name)).size, WEAPONS.length);
  for (const w of WEAPONS) {
    assert.match(w.base, /^(MAIN|2H|OFF)_[A-Z0-9_]+$/);
    assert.ok(w.name.length > 0 && w.name.length <= 40, w.name);
    assert.ok(!/[`*_~|<>@#\\\[\]]/.test(w.name), `markdown character in ${w.name}`);
    assert.ok(w.iconTier >= 1 && w.iconTier <= 8);
  }
  assert.ok(searchWeapons(WEAPONS, "great axe").length > 0 || searchWeapons(WEAPONS, "greataxe").length > 0);
});

import { WEAPON_CLASSES, isWeaponClass, weaponClass, weaponsOfClass } from "../../src/domain/weapons.ts";

test("every weapon in the data has a class, no class is empty or over 25, and there are at most 25 classes", () => {
  assert.ok(WEAPON_CLASSES.length <= 25);
  const counts = new Map<string, number>();
  for (const w of WEAPONS) counts.set(weaponClass(w), (counts.get(weaponClass(w)) ?? 0) + 1);
  // "Other" must stay empty: a new weapon family in a data refresh needs a decision, so the test says so.
  assert.equal(counts.get("Other") ?? 0, 0, `unmapped families: ${WEAPONS.filter((w) => weaponClass(w) === "Other").map((w) => w.base).join(", ")}`);
  for (const cls of WEAPON_CLASSES.filter((c) => c !== "Other")) {
    const n = counts.get(cls) ?? 0;
    assert.ok(n > 0 && n <= 25, `${cls}: ${n}`);
    assert.equal(weaponsOfClass(WEAPONS, cls).length, n);
  }
  assert.equal([...counts.values()].reduce((a, b) => a + b, 0), WEAPONS.length);
});

test("classes: off-hands are one class, known weapons land in the expected class, names are sorted", () => {
  const byName = (name: string) => weaponClass(WEAPONS.find((w) => w.name === name)!);
  assert.equal(byName("Broadsword"), "Sword");
  assert.equal(byName("Greataxe"), "Axe");
  assert.equal(byName("Great Holy Staff"), "Holy Staff");
  assert.equal(byName("Longbow"), "Bow");
  assert.equal(byName("Shield"), "Off-hand");
  assert.equal(byName("Icicle Staff"), "Frost Staff");
  const names = weaponsOfClass(WEAPONS, "Sword").map((w) => w.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.equal(isWeaponClass("Sword"), true);
  assert.equal(isWeaponClass("Wand"), false);
  assert.equal(weaponClass({ base: "2H_NEWTHING", name: "N", slot: "2h", iconTier: 4 }), "Other");
});
