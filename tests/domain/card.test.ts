import { test } from "node:test";
import assert from "node:assert/strict";
import { matchTags, typesFor, validateCard, type CardInput } from "../../src/domain/card.ts";

const NOW = new Date("2026-10-24T12:00:00Z");
const good: CardInput = {
  type: "pvp", kind: "zvz", title: "Ava roam", startText: "2026-10-25 18:00", gearTier: "T8", notes: null,
  slots: [{ role: "Tank", weapon: "Mace" }], slotsText: null,
};

test("a complete card is valid and gives what creation needs", () => {
  const r = validateCard(good, NOW);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && [r.value.type, r.value.kind, r.value.title, r.value.startsAt.toISOString(), r.value.tier, r.value.notes, r.value.slots.length], ["pvp", "zvz", "Ava roam", "2026-10-25T18:00:00.000Z", "T8", null, 1]);
});

test("every problem is listed at once, in the card's order", () => {
  const r = validateCard({ type: null, kind: "other", title: null, startText: "2020-01-01 10:00", gearTier: "", notes: null, slots: [], slotsText: null }, NOW);
  assert.ok(!r.ok);
  const p = !r.ok ? r.problems : [];
  assert.equal(p.length, 5);
  assert.match(p[0]!, /type/i);
  assert.match(p[1]!, /title/i);
  assert.match(p[2]!, /past|future/i);
  assert.match(p[3]!, /gear tier/i);
  assert.match(p[4]!, /slots/i);
});

test("typed slots that do not parse are reported with the parser's reason, and a wrong-type category is refused", () => {
  const r = validateCard({ ...good, slotsText: "Tank - Mace (Captain)" }, NOW);
  assert.ok(!r.ok && r.problems.some((x) => /Unknown duty/.test(x)));
  const k = validateCard({ ...good, kind: "mists" }, NOW);
  assert.ok(!k.ok && k.problems.some((x) => /PvE category/.test(x)));
  const many = validateCard({ ...good, slots: Array.from({ length: 21 }, () => ({ role: "DPS", weapon: "" })) }, NOW);
  assert.ok(!many.ok && many.problems.some((x) => /20/.test(x)));
});

test("a forum's type limits the content types: PvP or PvE with PvX, or all three", () => {
  assert.deepEqual(typesFor("pvp"), ["pvp", "pvx"]);
  assert.deepEqual(typesFor("pve"), ["pve", "pvx"]);
  assert.deepEqual(typesFor(null), ["pvp", "pve", "pvx"]);
});

test("forum tags match the type or the category by name, ignoring case; at most five", () => {
  const tags = [{ id: "1", name: "pvp" }, { id: "2", name: "ZvZ" }, { id: "3", name: "PvE" }, { id: "4", name: "Mists" }];
  assert.deepEqual(matchTags(tags, "pvp", "zvz"), ["1", "2"]);
  assert.deepEqual(matchTags(tags, "pve", "mists"), ["3", "4"]);
  assert.deepEqual(matchTags(tags, "pvx", "other"), []);
  assert.deepEqual(matchTags([], "pvp", "zvz"), []);
});
