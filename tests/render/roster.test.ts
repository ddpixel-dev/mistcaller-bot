import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUtc, escapeText, renderRosterMessage } from "../../src/render/roster.ts";
import { fillBar, roleIcon } from "../../src/render/theme.ts";
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
    votes: { split: 0, regear: 0 }, voteClosed: false, voteResult: null, started: false,
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
    "Spoils: Yes", "1. Tank - Axe · sworn: <@111>", "2. Healer - Holy · open", "The Company (1/2)"]) {
    assert.ok(d.includes(s), s);
  }
});

test("no loot and single tier", () => {
  const d = desc(view({ hasLoot: false, tier: { min: { tier: 5, enchant: 3 }, max: null } }));
  assert.ok(d.includes("Spoils: No"));
  assert.ok(d.includes("T5.3"));
  assert.ok(!d.includes("T5.3–"));
});

test("title escaped, no mentions", () => {
  const m = renderRosterMessage(view({ title: "@everyone **x**" }));
  assert.ok(m.embeds[0]!.title!.includes("@​everyone \\*\\*x\\*\\*"));
  assert.deepEqual(m.allowed_mentions, { parse: [] });
});

test("escapeText", () => {
  assert.equal(escapeText("\\*_~`|>#[]@a"), "\\\\\\*\\_\\~\\`\\|\\>\\#\\[\\]@\u200Ba");
});

test("escapeText neutralises masked links, timestamps, custom emoji and autolinks", () => {
  const z = "\u200B";
  assert.equal(escapeText("[x](http://evil)"), "\\[x\\](http://evil)");
  assert.equal(escapeText("<t:1:F>"), `<${z}t:1:F\\>`);
  assert.equal(escapeText("<:emoji:123>"), `<${z}:emoji:123\\>`);
  assert.equal(escapeText("<http://evil.example>"), `<${z}http://evil.example\\>`);
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

test("components: select with slot options and no public Leave button", () => {
  const rows = renderRosterMessage(view({ hasLoot: false })).components as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 1);
  const sel = rows[0].components[0];
  assert.equal(sel.type, 3);
  assert.equal(sel.custom_id, "signup:c1");
  assert.equal(sel.placeholder, "Pick a position");
  assert.ok(!sel.disabled);
  assert.deepEqual(sel.options, [
    { label: "1. Tank - Axe", value: "s1", description: "Taken" },
    { label: "2. Healer - Holy", value: "s2", description: "Open" },
  ]);
});

test("select labels are truncated to 100 and not markdown-escaped", () => {
  const sel = (renderRosterMessage(view({ slots: [{ id: "s", position: 1, role: "_R_" + "x".repeat(150), weapon: "W", userId: null }] })).components as any[])[0].components[0];
  assert.equal(sel.options[0].label.length, 100);
  assert.ok(sel.options[0].label.startsWith("1. _R_x"));
});

test("label truncation is code-point safe", () => {
  const role = "\u{1F600}".repeat(150);
  const sel = (renderRosterMessage(view({ slots: [{ id: "s", position: 1, role, weapon: "W", userId: null }] })).components as any[])[0].components[0];
  const label: string = sel.options[0].label;
  assert.equal(Array.from(label).length, 100);
  assert.ok(!/[\ud800-\udbff]$/.test(label));
});

test("select is disabled once started even though status is open", () => {
  const rows = renderRosterMessage(view({ status: "open", started: true })).components as any[];
  assert.equal(rows[0].components[0].disabled, true);
  assert.equal((renderRosterMessage(view({ started: false })).components as any[])[0].components[0].disabled, false);
});

test("locked: select disabled", () => {
  const rows = renderRosterMessage(view({ status: "locked" })).components as any[];
  assert.equal(rows[0].components[0].disabled, true);
});

test("cancelled and done: select disabled", () => {
  for (const status of ["cancelled", "done"] as const) {
    const rows = renderRosterMessage(view({ status })).components as any[];
    assert.equal(rows[0].components[0].disabled, true);
  }
});

const voteRow = (v: RosterView) => (renderRosterMessage(v).components as any[])[1];

test("vote row: open loot shows counts, enabled, styles and ids", () => {
  const rows = renderRosterMessage(view({ votes: { split: 3, regear: 2 } })).components as any[];
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], {
    type: 1,
    components: [
      { type: 2, style: 1, label: "Split (3)", custom_id: "vote:c1:split", disabled: false },
      { type: 2, style: 3, label: "Regear (2)", custom_id: "vote:c1:regear", disabled: false },
    ],
  });
});

test("vote line placement while open", () => {
  const d = desc(view({ notes: "hello", votes: { split: 3, regear: 2 } }));
  const lines = d.split("\n");
  const t = lines.findIndex((l) => l.includes("Tier **"));
  assert.equal(lines[t + 2], "Spoils vote: Split 3 - Regear 2");
  assert.ok(d.indexOf("Spoils vote:") < d.indexOf("**The Company"));
  assert.equal(d.split("Spoils vote").length, 2);
});

test("after cutoff: disabled buttons and result lines", () => {
  const closed = { voteClosed: true };
  const r1 = view({ ...closed, votes: { split: 3, regear: 2 }, voteResult: "split" });
  assert.ok(desc(r1).includes("Spoils vote result: Split won 3-2"));
  assert.ok(!desc(r1).includes("Spoils vote:"));
  assert.equal(voteRow(r1).components[0].disabled, true);
  assert.equal(voteRow(r1).components[1].disabled, true);
  assert.ok(desc(view({ ...closed, votes: { split: 2, regear: 3 }, voteResult: "regear" })).includes("Spoils vote result: Regear won 3-2"));
  assert.ok(desc(view({ ...closed, votes: { split: 2, regear: 2 }, voteResult: "tie" })).includes("Spoils vote result: Tie 2-2"));
  assert.ok(desc(view({ ...closed, votes: { split: 0, regear: 0 }, voteResult: "none" })).includes("Spoils vote result: no votes"));
});

test("vote buttons disabled when cancelled or done", () => {
  for (const status of ["cancelled", "done"] as const) {
    const row = voteRow(view({ status }));
    assert.equal(row.components[0].disabled, true);
    assert.equal(row.components[1].disabled, true);
  }
  assert.equal(voteRow(view({ status: "locked" })).components[0].disabled, false);
});

test("no loot: no vote row and no vote line", () => {
  const v = view({ hasLoot: false, voteClosed: true, voteResult: "none" });
  assert.equal((renderRosterMessage(v).components as any[]).length, 1);
  assert.ok(!desc(v).includes("Spoils vote"));
});

test("20 max-length slots plus a result line stays under 4096", () => {
  const slots = Array.from({ length: 20 }, (_, i) => ({
    id: `s${i}`, position: i + 1, role: "*".repeat(30), weapon: "*".repeat(40), userId: "123456789012345678",
  }));
  const v = view({ slots, title: "*".repeat(100), notes: "*".repeat(500), voteClosed: true, votes: { split: 20, regear: 0 }, voteResult: "split" });
  const d = desc(v);
  assert.ok(d.length <= 4096);
  assert.ok(d.includes("Spoils vote result: Split won 20-0"));
});

test("banner style: color by type, scroll and fleur-de-lis title, rules and fill bar", () => {
  const pvp = renderRosterMessage(view({ type: "pvp" })).embeds[0]!;
  const pve = renderRosterMessage(view({ type: "pve" })).embeds[0]!;
  assert.equal(pvp.color, 0x2b4db0);
  assert.equal(pve.color, 0xc9a227);
  assert.equal(pvp.title, "📜 ⚜ Ava roam ⚜");
  const d = pvp.description!;
  assert.equal(d.split("═══════════════════════").length, 3);
  assert.ok(d.includes("▰▰▰▰▰▱▱▱▱▱"));
  assert.ok(d.includes("The Company (1/2)"));
});

test("fill bar edge cases", () => {
  assert.equal(fillBar(0, 5), "▱▱▱▱▱▱▱▱▱▱");
  assert.equal(fillBar(5, 5), "▰▰▰▰▰▰▰▰▰▰");
  assert.equal(fillBar(0, 0), "▱▱▱▱▱▱▱▱▱▱");
  assert.equal(fillBar(9, 3), "▰▰▰▰▰▰▰▰▰▰");
});

test("role icons by keyword with a default", () => {
  assert.equal(roleIcon("Main Tank"), "🛡️");
  assert.equal(roleIcon("Healer"), "✚");
  assert.equal(roleIcon("Scout"), "🏹");
  assert.equal(roleIcon("Whatever"), "🔹");
  assert.ok(desc(view()).includes("🛡️ 1. Tank - Axe"));
});

test("cancelled and done are greyed with a status banner and nothing enabled", () => {
  const c = renderRosterMessage(view({ status: "cancelled" }));
  assert.equal(c.embeds[0]!.color, 0x6b6b6b);
  assert.ok(c.embeds[0]!.description!.includes("Cancelled."));
  const rows = c.components as any[];
  assert.ok(rows.every((r) => r.components.every((x: any) => x.disabled === true)));
  const d = renderRosterMessage(view({ status: "done" }));
  assert.equal(d.embeds[0]!.color, 0x4a4a4a);
  assert.ok(d.embeds[0]!.description!.includes("Concluded."));
  assert.ok(desc(view({ status: "locked" })).includes("The roll is closed."));
  assert.ok(!desc(view()).includes("closed"));
});
