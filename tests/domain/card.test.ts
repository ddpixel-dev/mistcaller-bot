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
  const k = validateCard({ ...good, kind: "world-boss" }, NOW);
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

import { pickEventForum, validateBlank } from "../../src/domain/card.ts";

test("normal content goes to the forum of its type, then a forum for any type, and PvX prefers a forum for any type", () => {
  const forums = [{ forumId: "pvp-f", type: "pvp" as const }, { forumId: "pve-f", type: "pve" as const }];
  assert.equal(pickEventForum(forums, "pvp")?.forumId, "pvp-f");
  assert.equal(pickEventForum(forums, "pve")?.forumId, "pve-f");
  assert.equal(pickEventForum([...forums, { forumId: "any-f", type: null }], "pvx")?.forumId, "any-f");
  assert.equal(pickEventForum([...forums, { forumId: "any-f", type: null }], "pvp")?.forumId, "pvp-f", "an exact type wins");
  assert.equal(pickEventForum([{ forumId: "any-f", type: null }], "pve")?.forumId, "any-f");
  assert.equal(pickEventForum(forums, "pvx")?.forumId, "pvp-f", "PvX fits either, so the first forum takes it");
  assert.equal(pickEventForum([], "pvp"), null);
  assert.equal(pickEventForum([{ forumId: "pvp-f", type: "pvp" }], "pve"), null, "no forum takes PvE");
});

test("a blank content needs a type (CTA needs none: it is PvX), a title, a start and a gear tier; the description is optional", () => {
  const NOW = new Date("2026-10-24T12:00:00Z");
  const ok = validateBlank({ type: "pvp", title: "Roam", startText: "2026-10-25 18:00", gearTier: "T8", notes: "bring food" }, false, NOW);
  assert.deepEqual(ok.ok && [ok.value.type, ok.value.title, ok.value.tier, ok.value.notes], ["pvp", "Roam", "T8", "bring food"]);
  assert.equal(validateBlank({ type: "pvp", title: "Roam", startText: "2026-10-25 18:00", gearTier: "T8", notes: null }, false, NOW).ok, true, "no description is fine");
  const noType = validateBlank({ type: null, title: "Roam", startText: "2026-10-25 18:00", gearTier: "T8", notes: null }, false, NOW);
  assert.deepEqual(noType, { ok: false, problems: ["Pick the type of content (PvP or PvE) first."] });
  const cta = validateBlank({ type: null, title: "Roam", startText: "2026-10-25 18:00", gearTier: "T8", notes: null }, true, NOW);
  assert.equal(cta.ok && cta.value.type, "pvx");
  const bad = validateBlank({ type: "pvp", title: null, startText: "soon", gearTier: null, notes: null }, false, NOW);
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.problems.length, 3, "title, start and gear tier");
});
