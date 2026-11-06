import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS, kindDef, kindsOf, resolveKind } from "../../src/domain/kinds.ts";

test("the lists match ADR 0010 and FR-023: 17 PvP and 12 PvE kinds, Other in each", () => {
  assert.equal(KINDS.filter((k) => k.type === "pvp").length, 17);
  assert.equal(KINDS.filter((k) => k.type === "pve").length, 12);
  assert.ok(kindDef("pvp", "other") && kindDef("pve", "other"));
  assert.ok(kindDef("pvp", "skirmish") && kindDef("pvp", "training"));
  assert.ok(kindDef("pvp", "gank-squad") && kindDef("pvp", "bomb-squad"));
  assert.ok(!kindDef("pve", "gank-squad") && !kindDef("pve", "bomb-squad"));
});

test("ids are unique within a type", () => {
  for (const type of ["pvp", "pve"] as const) {
    const ids = KINDS.filter((k) => k.type === type).map((k) => k.id);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test("resolveKind defaults to Other, accepts matching kinds and refuses others", () => {
  assert.deepEqual(resolveKind("pvp", null), { ok: true, value: "other" });
  assert.deepEqual(resolveKind("pve", ""), { ok: true, value: "other" });
  assert.deepEqual(resolveKind("pvp", "zvz"), { ok: true, value: "zvz" });
  assert.deepEqual(resolveKind("pve", "other"), { ok: true, value: "other" });
  const wrong = resolveKind("pvp", "world-boss");
  assert.equal(wrong.ok, false);
  assert.match((wrong as { error: string }).error, /World boss is a PvE category/);
  assert.equal(resolveKind("pve", "bogus").ok, false);
});

test("Fame farming and Avalonian gold chest are no longer offered, but old content keeps its label", () => {
  for (const id of ["fame-farming", "gold-chest"]) {
    assert.ok(!kindsOf("pve").some((k) => k.id === id) && !kindsOf("pvx").some((k) => k.id === id), id);
    assert.equal(resolveKind("pve", id).ok, false, "new content cannot pick it");
    assert.ok(kindDef("pve", id), "an old post still shows its category");
  }
  assert.equal(kindDef("pve", "gold-chest")!.label, "Avalonian gold chest");
  assert.equal(kindDef("pve", "fame-farming")!.label, "Fame farming");
});

test("the new PvE and PvP categories (FR-023), Ancient Lands and Hellgate in both, each before Other", () => {
  const pvp = kindsOf("pvp").map((k) => k.id);
  const pve = kindsOf("pve").map((k) => k.id);
  for (const id of ["static-dungeon", "dragon-sanctuary", "hellgate", "depths", "crystal-creatures", "ancient-lands"]) assert.ok(pve.includes(id), `PvE ${id}`);
  for (const id of ["outposts", "castle", "ancient-lands", "hellgate"]) assert.ok(pvp.includes(id), `PvP ${id}`);
  assert.ok(!pvp.includes("static-dungeon") && !pve.includes("castle") && !pve.includes("outposts"));
  assert.equal(pvp.at(-1), "other");
  assert.equal(pve.at(-1), "other");
  assert.equal(resolveKind("pve", "ancient-lands").ok && resolveKind("pvp", "ancient-lands").ok, true);
  assert.equal(kindDef("pve", "depths")!.label, "Depths");
  assert.equal(kindDef("pve", "hellgate")!.label, "Hellgate");
  const pvx = kindsOf("pvx").map((k) => k.id);
  assert.equal(new Set(pvx).size, pvx.length, "a shared id is listed once");
  assert.ok(pvx.length <= 25, "a menu holds 25 options at most");
  assert.ok(pvx.includes("castle") && pvx.includes("depths") && pvx.includes("ancient-lands") && pvx.at(-1) === "other");
});

test("Ava Gank is a PvP category and Ava Gold a PvE one, each before Other, and PvX has both", () => {
  const pvp = kindsOf("pvp").map((k) => k.id);
  const pve = kindsOf("pve").map((k) => k.id);
  assert.ok(pvp.includes("ava-gank") && !pve.includes("ava-gank"));
  assert.ok(pve.includes("ava-gold") && !pvp.includes("ava-gold"));
  assert.equal(pvp.at(-1), "other");
  assert.equal(pve.at(-1), "other");
  assert.equal(kindDef("pvp", "ava-gank")!.label, "Ava Gank");
  assert.equal(kindDef("pve", "ava-gold")!.label, "Ava Gold");
  const pvx = kindsOf("pvx").map((k) => k.id);
  assert.ok(pvx.includes("ava-gank") && pvx.includes("ava-gold"));
  assert.ok(pvx.length <= 25, "a menu holds 25 options at most");
  assert.equal(resolveKind("pvp", "ava-gank").ok, true);
  assert.equal(resolveKind("pve", "ava-gank").ok, false, "a PvP category on PvE content is refused");
  assert.equal(resolveKind("pve", "ava-gold").ok, true);
  assert.equal(resolveKind("pvp", "ava-gold").ok, false);
});

test("every category has one icon, and each type has a fallback icon", async () => {
  const { typeIcon, kindIcon } = await import("../../src/domain/kinds.ts");
  for (const k of KINDS) assert.ok(k.icon && /\p{Extended_Pictographic}/u.test(k.icon), k.id);
  assert.deepEqual([typeIcon("pvp"), typeIcon("pve"), typeIcon("pvx")], ["⚔️", "🐉", "🌀"]);
  assert.equal(kindIcon("pvp", "zvz"), "🏰");
  assert.equal(kindIcon("pve", "other"), "🐉");
  assert.equal(kindIcon("pvp", "nonsense"), "⚔️");
});

test("Mists and Corrupted dungeon are PvP categories now, and old PvE content keeps its label", () => {
  for (const id of ["mists", "corrupted-dungeon"]) {
    assert.ok(kindsOf("pvp").some((k) => k.id === id), `PvP ${id}`);
    assert.ok(!kindsOf("pve").some((k) => k.id === id), `not PvE ${id}`);
    assert.equal(resolveKind("pvp", id).ok, true);
    assert.equal(resolveKind("pve", id).ok, false, "new PvE content cannot pick it");
    assert.ok(kindDef("pve", id), "an old PvE post still shows its category");
  }
});

test("every list is alphabetical by label with Other last, PvX included", () => {
  for (const type of ["pvp", "pve", "pvx"] as const) {
    const labels = kindsOf(type).map((k) => k.label);
    assert.equal(labels.at(-1), "Other", type);
    const rest = labels.slice(0, -1);
    assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b, "en")), type);
  }
});

test("Ava Skip is a PvE category, in the PvX menu too, and not a PvP one", () => {
  assert.equal(kindDef("pve", "ava-skip")!.label, "Ava Skip");
  assert.ok(kindsOf("pve").some((k) => k.id === "ava-skip") && !kindsOf("pvp").some((k) => k.id === "ava-skip"));
  assert.ok(kindsOf("pvx").some((k) => k.id === "ava-skip"));
  assert.equal(resolveKind("pve", "ava-skip").ok, true);
  assert.equal(resolveKind("pvp", "ava-skip").ok, false);
  assert.ok(kindsOf("pvx").length <= 25, "a menu holds 25 options at most");
});

test("Avalonian raid is retired: not offered anywhere, but old content keeps its label; PvX is back to leaving out only Training", () => {
  for (const type of ["pve", "pvx"] as const) assert.ok(!kindsOf(type).some((k) => k.id === "avalonian-raid"), type);
  assert.equal(resolveKind("pve", "avalonian-raid").ok, false);
  assert.equal(kindDef("pve", "avalonian-raid")!.label, "Avalonian raid");
  const pvx = kindsOf("pvx").map((k) => k.id);
  assert.ok(pvx.includes("skirmish") && !pvx.includes("training"));
  assert.ok(pvx.length <= 25);
});

test("the PvP category is called Outpost, in the singular", () => {
  assert.equal(kindDef("pvp", "outposts")!.label, "Outpost");
  assert.ok(!kindsOf("pvp").some((k) => k.label === "Outposts"));
});
