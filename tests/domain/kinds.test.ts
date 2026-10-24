import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS, kindDef, kindsOf, resolveKind } from "../../src/domain/kinds.ts";

test("the lists match ADR 0010: 12 PvP and 9 PvE kinds, Other in each", () => {
  assert.equal(KINDS.filter((k) => k.type === "pvp").length, 12);
  assert.equal(KINDS.filter((k) => k.type === "pve").length, 9);
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
  const wrong = resolveKind("pvp", "mists");
  assert.equal(wrong.ok, false);
  assert.match((wrong as { error: string }).error, /Mists is a PvE category/);
  assert.equal(resolveKind("pve", "bogus").ok, false);
});

test("Avalonian gold chest is a PvE category, listed before Other, and PvX has it too", () => {
  const pve = kindsOf("pve").map((k) => k.id);
  assert.ok(pve.includes("gold-chest"));
  assert.equal(pve.at(-1), "other");
  assert.equal(kindDef("pve", "gold-chest")!.label, "Avalonian gold chest");
  assert.ok(kindsOf("pvx").some((k) => k.id === "gold-chest"));
  assert.equal(resolveKind("pve", "gold-chest").ok, true);
  assert.equal(resolveKind("pvp", "gold-chest").ok, false);
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
