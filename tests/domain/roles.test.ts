import { test } from "node:test";
import assert from "node:assert/strict";
import { roleRank, sortByRole } from "../../src/domain/roles.ts";

test("roles sort Tank, DTank, Healer, Support, DPS, then any other role in the order it was written", () => {
  const roles = ["DPS", "Bomber", "healer", "Tank", "Caller", "Support", "DTank", "DPS", "tank"];
  assert.deepEqual(sortByRole(roles.map((role, i) => ({ role, i }))).map((s) => `${s.role}${s.i}`),
    ["Tank3", "tank8", "DTank6", "healer2", "Support5", "DPS0", "DPS7", "Bomber1", "Caller4"]);
  assert.ok(roleRank(" Tank ") < roleRank("DTank"));
  assert.equal(roleRank("Bomber"), roleRank("Caller"));
});

test("FR-076: weapon slots (no role) keep their typed order, after any role slot", () => {
  const out = sortByRole([{ role: "", weapon: "Mace" }, { role: "Tank", weapon: "" }, { role: "", weapon: "Bow" }]);
  assert.deepEqual(out.map((s) => s.weapon || s.role), ["Tank", "Mace", "Bow"]);
});
