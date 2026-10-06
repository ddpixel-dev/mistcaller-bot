import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUtc, escapeText, renderRosterMessage } from "../../src/render/roster.ts";
import type { RosterView } from "../../src/domain/types.ts";

function view(over: Partial<RosterView> = {}): RosterView {
  return {
    id: "c1", guildId: "g1", threadId: "t1", messageId: null, type: "pvp",
    title: "Ava roam", notes: null,
    startsAt: new Date("2026-10-07T18:00:00Z"),
    tier: { min: { tier: 5, enchant: 3 }, max: { tier: 7, enchant: 0 } },
    hasLoot: true, status: "open",
    slots: [
      { id: "s1", position: 1, role: "Tank", weapon: "Axe", userId: "111" },
      { id: "s2", position: 2, role: "Healer", weapon: "Holy", userId: null },
    ],
    votes: { split: 0, regear: 0 }, voteClosed: false, voteResult: null,
    ...over,
  };
}
const desc = (v: RosterView) => renderRosterMessage(v).embeds[0]!.description as string;

test("formatUtc", () => {
  assert.equal(formatUtc(new Date("2026-10-07T18:00:00Z")), "Wed 7 Oct 2026, 18:00 UTC");
});

test("description contents", () => {
  const d = desc(view());
  for (const s of ["Wed 7 Oct 2026, 18:00 UTC", "<t:1791396000:F>", "<t:1791396000:R>", "T5.3–T7.0", "PvP",
    "Loot: Yes", "1. Tank - Axe · <@111>", "2. Healer - Holy · open", "Roster (1/2)"]) {
    assert.ok(d.includes(s), s);
  }
});

test("no loot and single tier", () => {
  const d = desc(view({ hasLoot: false, tier: { min: { tier: 5, enchant: 3 }, max: null } }));
  assert.ok(d.includes("Loot: No"));
  assert.ok(d.includes("T5.3"));
  assert.ok(!d.includes("T5.3–"));
});

test("title escaped, no mentions", () => {
  const m = renderRosterMessage(view({ title: "@everyone **x**" }));
  assert.ok(m.embeds[0]!.title!.includes("@​everyone \\*\\*x\\*\\*"));
  assert.deepEqual(m.allowed_mentions, { parse: [] });
});

test("escapeText", () => {
  assert.equal(escapeText("\\*_~`|>#@a"), "\\\\\\*\\_\\~\\`\\|\\>\\#@​a");
});

test("user text escaped in notes, role and weapon", () => {
  const d = desc(view({ notes: "@here *hi*", slots: [{ id: "s", position: 1, role: "_R_", weapon: "@W", userId: null }] }));
  assert.ok(d.includes("@​here \\*hi\\*"));
  assert.ok(d.includes("\\_R\\_ - @​W"));
});

test("limits with maximum-length content", () => {
  const slots = Array.from({ length: 20 }, (_, i) => ({
    id: `s${i}`, position: i + 1, role: "R".repeat(30), weapon: "W".repeat(40), userId: "123456789012345678",
  }));
  const m = renderRosterMessage(view({ slots, title: "T".repeat(100), notes: "N".repeat(500) }));
  assert.ok(m.embeds[0]!.description!.length < 4096);
  assert.ok(m.embeds[0]!.title!.length <= 256);
  const worst = Array.from({ length: 20 }, (_, i) => ({
    id: `s${i}`, position: i + 1, role: "*".repeat(30), weapon: "*".repeat(40), userId: null,
  }));
  const w = renderRosterMessage(view({ slots: worst, title: "*".repeat(100), notes: "*".repeat(500) }));
  assert.ok(w.embeds[0]!.description!.length < 4096);
  assert.ok(w.embeds[0]!.title!.length <= 256);
});

test("components empty", () => {
  assert.deepEqual(renderRosterMessage(view()).components, []);
});
