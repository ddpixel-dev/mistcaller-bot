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

test("the card's start: now plus an hour, rounded up to the next quarter hour (ADR 0033)", async () => {
  const { cardStart } = await import("../../src/domain/time.ts");
  assert.equal(cardStart(new Date("2026-10-24T12:00:00Z")), "2026-10-24 13:00");
  assert.equal(cardStart(new Date("2026-10-24T12:01:00Z")), "2026-10-24 13:15");
  assert.equal(cardStart(new Date("2026-10-24T23:50:00Z")), "2026-10-25 01:00");
});

test("the start menus change one part of the start; a start that cannot be read starts from the default", async () => {
  const { withStartPart, startParts } = await import("../../src/domain/time.ts");
  const now = new Date("2026-10-24T12:00:00Z");
  assert.deepEqual(startParts("2026-10-25 18:30"), { day: "2026-10-25", hour: "18", minute: "30" });
  assert.equal(startParts("tomorrow"), null);
  assert.equal(withStartPart("2026-10-25 18:30", "day", "2026-10-27", now), "2026-10-27 18:30");
  assert.equal(withStartPart("2026-10-25 18:30", "hour", "07", now), "2026-10-25 07:30");
  assert.equal(withStartPart("2026-10-25 18:30", "minute", "45", now), "2026-10-25 18:45");
  assert.equal(withStartPart("garbage", "hour", "20", now), "2026-10-24 20:00");
  assert.equal(withStartPart("2026-10-25 18:30", "hour", "24", now), null, "out of range");
  assert.equal(withStartPart("2026-10-25 18:30", "minute", "20", now), null, "quarters only");
  assert.equal(withStartPart("2026-10-25 18:30", "day", "2026-02-30", now), null);
});

test("the Day menu offers today and the next 13 days, and keeps a chosen day outside that range", async () => {
  const { dayChoices } = await import("../../src/domain/time.ts");
  const now = new Date("2026-10-24T12:00:00Z");
  const days = dayChoices(now, "2026-10-25");
  assert.equal(days.length, 14);
  assert.deepEqual(days.slice(0, 3).map((d) => d.label), ["Today · Sat 24 Oct", "Tomorrow · Sun 25 Oct", "Mon 26 Oct"]);
  assert.equal(days[0]!.value, "2026-10-24");
  const far = dayChoices(now, "2026-12-01");
  assert.equal(far.length, 15);
  assert.equal(far[0]!.value, "2026-12-01");
});
