import { test } from "node:test";
import assert from "node:assert/strict";
import { postName } from "../../src/domain/postname.ts";

test("the post is named: title | day and month | time UTC", () => {
  assert.equal(postName("Ava roam", new Date("2026-11-12T20:00:00Z")), "Ava roam | 12 Nov | 20:00 UTC");
  assert.equal(postName("ZvZ", new Date("2026-12-01T07:05:00Z")), "ZvZ | 1 Dec | 07:05 UTC", "no zero on the day, two digits for the time");
});

test("the name never passes Discord's 100 characters: only the title is cut", () => {
  const name = postName("x".repeat(100), new Date("2026-11-12T20:00:00Z"));
  assert.equal(Array.from(name).length, 100);
  assert.ok(name.endsWith(" | 12 Nov | 20:00 UTC"));
  const emoji = postName("🔥".repeat(100), new Date("2026-11-12T20:00:00Z"));
  assert.equal(Array.from(emoji).length <= 100, true);
  assert.ok(emoji.endsWith(" | 12 Nov | 20:00 UTC"));
});

test("the date is read in UTC, whatever the server's zone", () => {
  assert.equal(postName("A", new Date("2026-11-12T23:30:00Z")), "A | 12 Nov | 23:30 UTC");
  assert.equal(postName("A", new Date("2026-11-13T00:10:00Z")), "A | 13 Nov | 00:10 UTC");
});
