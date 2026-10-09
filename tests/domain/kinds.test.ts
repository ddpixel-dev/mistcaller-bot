import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS, kindChoices, kindDef, kindsOf, resolveKind } from "../../src/domain/kinds.ts";

test("the lists match ADR 0010: 11 PvP and 8 PvE kinds, Other in each", () => {
  assert.equal(KINDS.filter((k) => k.type === "pvp").length, 11);
  assert.equal(KINDS.filter((k) => k.type === "pve").length, 8);
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

test("command choices are distinct, within Discord's 25 limit, and name the type", () => {
  const c = kindChoices();
  assert.equal(c.length, 18);
  assert.ok(c.length <= 25);
  assert.equal(new Set(c.map((x) => x.value)).size, c.length);
  assert.ok(c.every((x) => x.name.length <= 100));
  assert.ok(c.some((x) => x.name === "Gank Squad (PvP)") && c.some((x) => x.name === "Bomb Squad (PvP)"));
  assert.ok(c.some((x) => x.name === "ZvZ (PvP)") && c.some((x) => x.name === "World boss (PvE)"));
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
  assert.ok(pve.includes("avalonian-gold-chest"));
  assert.equal(pve.at(-1), "other");
  assert.equal(kindDef("pve", "avalonian-gold-chest")!.label, "Avalonian gold chest");
  assert.ok(kindsOf("pvx").some((k) => k.id === "avalonian-gold-chest"));
  assert.equal(resolveKind("pve", "avalonian-gold-chest").ok, true);
  assert.equal(resolveKind("pvp", "avalonian-gold-chest").ok, false);
});
