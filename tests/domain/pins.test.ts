import { test } from "node:test";
import assert from "node:assert/strict";
import { findPinNotice } from "../../src/domain/pins.ts";

const msgs = [
  { id: "1", type: 0, message_reference: { message_id: "p" } },
  { id: "2", type: 6, message_reference: { message_id: "other" } },
  { id: "3", type: 6 },
  { id: "4", type: 6, message_reference: { message_id: "p" } },
];

test("finds the pin notice that points at the pinned message", () => {
  assert.equal(findPinNotice(msgs, "p"), "4");
});

test("null when there is none; a normal reply is not a notice", () => {
  assert.equal(findPinNotice(msgs, "zzz"), null);
  assert.equal(findPinNotice([], "p"), null);
  assert.equal(findPinNotice(msgs.slice(0, 1), "p"), null);
});
