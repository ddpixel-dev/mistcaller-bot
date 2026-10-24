import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultStart, utcInput } from "../../src/domain/time.ts";

test("utcInput writes a date as the form expects it", () => {
  assert.equal(utcInput(new Date("2026-10-05T07:09:00Z")), "2026-10-05 07:09");
});

test("the default start is now plus one hour, to the minute, in UTC", () => {
  assert.equal(defaultStart(new Date("2026-10-15T13:00:00Z")), "2026-10-15 14:00");
  assert.equal(defaultStart(new Date("2026-10-15T13:20:45Z")), "2026-10-15 14:20");
  assert.equal(defaultStart(new Date("2026-10-15T23:30:00Z")), "2026-10-16 00:30", "rolls over the day");
  assert.equal(defaultStart(new Date("2026-12-31T23:59:00Z")), "2027-01-01 00:59", "and the year");
});

