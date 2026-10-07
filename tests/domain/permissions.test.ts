import { test } from "node:test";
import assert from "node:assert/strict";
import { canManage, hasManageServer } from "../../src/domain/permissions.ts";

const actor = (over = {}) => ({ userId: "u1", roles: [] as string[], ...over });

test("creator can manage", () => {
  assert.equal(canManage(actor(), { createdBy: "u1" }, null), true);
  assert.equal(canManage(actor({ userId: "u2" }), { createdBy: "u1" }, null), false);
});

test("officer role can manage; null officer role matches nobody", () => {
  assert.equal(canManage(actor({ userId: "u2", roles: ["r9"] }), { createdBy: "u1" }, "r9"), true);
  assert.equal(canManage(actor({ userId: "u2", roles: ["r8"] }), { createdBy: "u1" }, "r9"), false);
  assert.equal(canManage(actor({ userId: "u2", roles: ["r9"] }), { createdBy: "u1" }, null), false);
});

test("Manage Server and Administrator can manage", () => {
  assert.equal(hasManageServer("32"), true);
  assert.equal(hasManageServer("8"), true);
  assert.equal(hasManageServer("1024"), false);
  assert.equal(hasManageServer(undefined), false);
  assert.equal(hasManageServer("not-a-number"), false);
  assert.equal(canManage(actor({ userId: "u2", permissions: "32" }), { createdBy: "u1" }, null), true);
});

test("a missing creator never matches an empty user", () => {
  assert.equal(canManage(actor({ userId: "" }), { createdBy: null }, null), false);
});
