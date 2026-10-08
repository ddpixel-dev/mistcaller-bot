import { test } from "node:test";
import assert from "node:assert/strict";
import { canManage, canManagePresets, hasManageServer, isAdmin } from "../../src/domain/permissions.ts";

const actor = (over = {}) => ({ userId: "u1", roles: [] as string[], ...over });

test("creator can manage", () => {
  assert.equal(canManage(actor(), { createdBy: "u1" }, []), true);
  assert.equal(canManage(actor({ userId: "u2" }), { createdBy: "u1" }, []), false);
});

test("any of the admin roles can manage; with no admin roles a role matches nobody", () => {
  const c = { createdBy: "u1" };
  assert.equal(canManage(actor({ userId: "u2", roles: ["r9"] }), c, ["r9"]), true);
  assert.equal(canManage(actor({ userId: "u2", roles: ["r2"] }), c, ["r1", "r2", "r3"]), true);
  assert.equal(canManage(actor({ userId: "u2", roles: ["r8"] }), c, ["r9"]), false);
  assert.equal(canManage(actor({ userId: "u2", roles: ["r9"] }), c, []), false);
});

test("Manage Server and Administrator can manage", () => {
  assert.equal(hasManageServer("32"), true);
  assert.equal(hasManageServer("8"), true);
  assert.equal(hasManageServer("1024"), false);
  assert.equal(hasManageServer(undefined), false);
  assert.equal(hasManageServer("not-a-number"), false);
  assert.equal(canManage(actor({ userId: "u2", permissions: "32" }), { createdBy: "u1" }, []), true);
});

test("a missing creator never matches an empty user", () => {
  assert.equal(canManage(actor({ userId: "" }), { createdBy: null }, []), false);
});

test("presets and admin status follow the admin roles and Manage Server, not the content's creator", () => {
  assert.equal(canManagePresets(actor({ roles: ["r1"] }), ["r1"]), true);
  assert.equal(canManagePresets(actor({ permissions: "8" }), []), true);
  assert.equal(canManagePresets(actor(), ["r1"]), false);
  assert.equal(isAdmin(actor({ roles: ["x"] }), ["r1"]), false);
});
