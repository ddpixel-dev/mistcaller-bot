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
  assert.deepEqual(typesFor("pvp"), ["pvp"]);
  assert.deepEqual(typesFor("pvx"), ["pvx"]);
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

test("normal content goes to the forum set for its type and nowhere else; one forum may serve several types", () => {
  const forums = [{ forumId: "pvp-f", type: "pvp" as const }, { forumId: "pve-f", type: "pve" as const }, { forumId: "pvp-f", type: "pvx" as const }];
  assert.equal(pickEventForum(forums, "pvp")?.forumId, "pvp-f");
  assert.equal(pickEventForum(forums, "pve")?.forumId, "pve-f");
  assert.equal(pickEventForum(forums, "pvx")?.forumId, "pvp-f", "PvX set to the PvP forum");
  assert.equal(pickEventForum(forums.slice(0, 2), "pvx"), null, "no fallback to another type's forum");
  assert.equal(pickEventForum([], "pvp"), null);
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

// ---- a CTA card (FR-070): no type or category, a role list, and up to two parties ----

const cta: CardInput = { ...good, type: null, kind: "other", cta: true, parties: 1, slots2: [], slots2Text: null };

test("a CTA needs no type or category: it is stored as PvX, Other", () => {
  const r = validateCard(cta, NOW);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && [r.value.type, r.value.kind, r.value.slots2, r.value.parties], ["pvx", "other", [], 1]);
});

test("normal content still needs a type and accepts any role", () => {
  assert.ok(!validateCard({ ...good, type: null }, NOW).ok);
  assert.ok(validateCard({ ...good, slots: [{ role: "Battlemount", weapon: "" }] }, NOW).ok);
});

test("a CTA refuses a role outside Tank, DTank, Healer, Support and DPS, in party 1 and party 2", () => {
  const one = validateCard({ ...cta, slotsText: "Tank\nHeal" }, NOW);
  assert.ok(!one.ok && one.problems.some((p) => p.includes('Line 2: "Heal" is not a supported role. Use Tank, DTank, Healer, Support or DPS.')), JSON.stringify(one));
  const two = validateCard({ ...cta, parties: 2, slots2Text: "Heal" }, NOW);
  assert.ok(!two.ok && two.problems.includes('Party 2, line 1: "Heal" is not a supported role. Use Tank, DTank, Healer, Support or DPS.'), JSON.stringify(two));
  const stored = validateCard({ ...cta, slots: [{ role: "Battlemount", weapon: "" }] }, NOW);
  assert.ok(!stored.ok && stored.problems.some((p) => p.includes('"Battlemount" is not a supported role')));
});

test("with two parties both must have slots; with one party party 2 is ignored", () => {
  const empty2 = validateCard({ ...cta, parties: 2 }, NOW);
  assert.ok(!empty2.ok && empty2.problems.some((p) => /party 2/i.test(p)));
  const empty1 = validateCard({ ...cta, parties: 2, slots: [], slots2: [{ role: "Tank", weapon: "" }] }, NOW);
  assert.ok(!empty1.ok && empty1.problems.some((p) => /party 1|add the slots/i.test(p)));
  const ok = validateCard({ ...cta, parties: 2, slots2: [{ role: "Healer", weapon: "Holy" }] }, NOW);
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && [ok.value.parties, ok.value.slots2.length], [2, 1]);
  const ignored = validateCard({ ...cta, parties: 1, slots2: [{ role: "Healer", weapon: "Holy" }], slots2Text: "Heal" }, NOW);
  assert.ok(ignored.ok);
  assert.deepEqual(ignored.ok && ignored.value.slots2, []);
});

test("normal content ignores parties", () => {
  const r = validateCard({ ...good, parties: 2, slots2: [] }, NOW);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && [r.value.parties, r.value.slots2], [1, []]);
});
