import { test } from "node:test";
import assert from "node:assert/strict";
import { canTakePosition, seatCounts } from "../../src/domain/seats.ts";

test("a fill reserves a seat: the party shows seated plus reserved fills, never more than the positions", () => {
  assert.deepEqual(seatCounts(10, 7, 0), { seated: 7, open: 3, reserved: 0, party: 7, available: 3 });
  assert.deepEqual(seatCounts(10, 7, 1), { seated: 7, open: 3, reserved: 1, party: 8, available: 2 });
  assert.deepEqual(seatCounts(10, 7, 3), { seated: 7, open: 3, reserved: 3, party: 10, available: 0 });
  assert.deepEqual(seatCounts(10, 7, 5), { seated: 7, open: 3, reserved: 3, party: 10, available: -2 }, "standby fills hold no seat");
  assert.deepEqual(seatCounts(10, 10, 2), { seated: 10, open: 0, reserved: 0, party: 10, available: -2 });
});

test("assigning a fill does not change the party count", () => {
  assert.equal(seatCounts(10, 7, 1).party, seatCounts(10, 8, 0).party);
});

test("a new seat can be taken only while open positions outnumber the fills; a fill taking a seat frees its reservation", () => {
  assert.equal(canTakePosition(3, 1, false), true, "3 open, 1 fill: 2 stay open for the fill");
  assert.equal(canTakePosition(2, 1, false), true);
  assert.equal(canTakePosition(1, 1, false), false, "the last open seat is the fill's");
  assert.equal(canTakePosition(0, 0, false), false, "nothing open");
  assert.equal(canTakePosition(1, 1, true), true, "the fill takes the seat held for them");
  assert.equal(canTakePosition(1, 2, true), false, "a standby fill has no seat to take");
  assert.equal(canTakePosition(2, 0, false), true);
});
