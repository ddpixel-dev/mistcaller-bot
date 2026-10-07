import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUtc, escapeText, renderRosterMessage } from "../../src/render/roster.ts";
import { fillBar, roleIcon } from "../../src/render/theme.ts";
import type { RosterView } from "../../src/domain/types.ts";

function view(over: Partial<RosterView> = {}): RosterView {
  return {
    id: "c1", guildId: "g1", threadId: "t1", messageId: null, type: "pvp", kind: "other",
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
  for (const s of ["Wed 7 Oct 2026, 18:00 UTC", "<t:1791396000:f>", "<t:1791396000:R>", "T5.3–T7.0", "PvP",
    "Loot vote: On", "1. Tank - Axe · sworn: <@111>", "2. Healer - Holy · open", "The Company (1/2)"]) {
    assert.ok(d.includes(s), s);
  }
});

test("no loot and single tier", () => {
  const d = desc(view({ hasLoot: false, tier: { min: { tier: 5, enchant: 3 }, max: null } }));
  assert.ok(d.includes("Loot vote: Off"));
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

const rowsOf = (v: RosterView) => renderRosterMessage(v).components as any[];
const lastRow = (v: RosterView) => rowsOf(v)[rowsOf(v).length - 1];
const slotButtons = (v: RosterView) => rowsOf(v).slice(0, -1).flatMap((r) => r.components);
const leaveBtn = (v: RosterView) => lastRow(v).components[0];
const nobodyIn = (v: RosterView) => v.slots.map((s) => ({ ...s, userId: null }));

test("one button per position plus a bottom row with Leave; a held position is dimmed", () => {
  const rows = rowsOf(view({ hasLoot: false }));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].components, [
    { type: 2, style: 2, label: "1. Tank - Axe", emoji: { name: "🛡️" }, custom_id: "pick:c1:s1", disabled: true },
    { type: 2, style: 2, label: "2. Healer - Holy", emoji: { name: "💚" }, custom_id: "pick:c1:s2", disabled: false },
  ]);
  assert.deepEqual(rows[1].components, [
    { type: 2, style: 4, label: "Leave", emoji: { name: "🚪" }, custom_id: "leave:c1", disabled: false },
  ]);
});

test("positions fill rows of five, and 20 positions with a loot vote still fit five rows", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, position: i + 1, role: "DPS", weapon: "Bow", userId: null }));
  const rows = rowsOf(view({ slots: twenty, hasLoot: true }));
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.slice(0, 4).map((r) => r.components.length), [5, 5, 5, 5]);
  assert.deepEqual(lastRow(view({ slots: twenty, hasLoot: true })).components.map((c: any) => c.custom_id), ["leave:c1", "vote:c1:split", "vote:c1:regear"]);
  assert.equal(rowsOf(view({ slots: twenty.slice(0, 6), hasLoot: false })).length, 3);
});

test("the Leave button is dimmed while nobody is signed up and enabled once anyone is", () => {
  assert.equal(leaveBtn(view({ slots: nobodyIn(view()) })).disabled, true);
  assert.equal(leaveBtn(view()).disabled, false);
});

test("Leave stays enabled after the start or lock, and is disabled when cancelled or done", () => {
  assert.equal(leaveBtn(view({ status: "open", started: true })).disabled, false);
  assert.equal(leaveBtn(view({ status: "locked" })).disabled, false);
  assert.equal(leaveBtn(view({ status: "cancelled" })).disabled, true);
  assert.equal(leaveBtn(view({ status: "done" })).disabled, true);
});

test("button labels are cut to 80 characters, code-point safe, and not markdown-escaped", () => {
  const long = view({ slots: [{ id: "s", position: 1, role: "_R_" + "x".repeat(150), weapon: "W", userId: null }] });
  assert.equal(slotButtons(long)[0].label.length, 80);
  assert.ok(slotButtons(long)[0].label.startsWith("1. _R_x"));
  const emoji = view({ slots: [{ id: "s", position: 1, role: "\u{1F600}".repeat(150), weapon: "W", userId: null }] });
  const label: string = slotButtons(emoji)[0].label;
  assert.equal(Array.from(label).length, 80);
  assert.ok(!/[\ud800-\udbff]$/.test(label));
});

test("every position button is dimmed once started, locked, cancelled or done; open ones are live", () => {
  for (const over of [{ status: "open", started: true }, { status: "locked" }, { status: "cancelled" }, { status: "done" }] as const) {
    assert.ok(slotButtons(view({ ...over, slots: nobodyIn(view()) })).every((b: any) => b.disabled === true));
  }
  assert.deepEqual(slotButtons(view({ slots: nobodyIn(view()) })).map((b: any) => b.disabled), [false, false]);
});

const voteRow = (v: RosterView) => ({ components: lastRow(v).components.slice(1) });

test("vote buttons: open loot shows counts, enabled, styles and ids", () => {
  assert.deepEqual(voteRow(view({ votes: { split: 3, regear: 2 } })).components, [
    { type: 2, style: 1, label: "Split (3)", custom_id: "vote:c1:split", disabled: false },
    { type: 2, style: 3, label: "Regear (2)", custom_id: "vote:c1:regear", disabled: false },
  ]);
});

test("vote line placement while open", () => {
  const d = desc(view({ notes: "hello", votes: { split: 3, regear: 2 } }));
  const lines = d.split("\n");
  const t = lines.findIndex((l) => l.includes("Tier **"));
  assert.equal(lines[t + 3], "💰 Spoils vote: Split 3 - Regear 2 · closes <t:1791395700:R>");
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

test("no loot: no vote buttons and no vote line", () => {
  const v = view({ hasLoot: false, voteClosed: true, voteResult: "none" });
  assert.equal(lastRow(v).components.length, 1);
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
  assert.equal(roleIcon("Healer"), "💚");
  assert.equal(roleIcon("Support"), "✨");
  assert.equal(roleIcon("DPS"), "⚔️");
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

test("time lines: UTC and Your time are separate labelled lines", () => {
  const lines = desc(view()).split("\n");
  assert.ok(lines.includes("🕰️ **UTC** · Wed 7 Oct 2026, 18:00 UTC"));
  assert.ok(lines.includes("🌍 **Your time** · <t:1791396000:f> · <t:1791396000:R>"));
});

test("notes get a Notes: label and a different icon than the title", () => {
  const d = desc(view({ notes: "bring food" }));
  assert.ok(d.includes("📝 **Notes:** bring food"));
  assert.ok(!d.includes("📜"));
});

test("the closing time of the vote is shown only while it is open", () => {
  assert.ok(desc(view()).includes("closes <t:1791395700:R>"));
  assert.ok(!desc(view({ voteClosed: true, voteResult: "none" })).includes("closes"));
});

test("a cancelled content says so in the title", () => {
  assert.equal(renderRosterMessage(view({ status: "cancelled" })).embeds[0]!.title, "✖ CANCELLED — Ava roam");
  assert.equal(renderRosterMessage(view({ status: "locked" })).embeds[0]!.title, "📜 ⚜ Ava roam ⚜");
});

test("kind shows in the label and sets the color; Other shows only the type", () => {
  const zvz = renderRosterMessage(view({ kind: "zvz" })).embeds[0]!;
  assert.ok(zvz.description!.includes("**PvP · ZvZ**"));
  assert.equal(zvz.color, 0x1c3a8a);
  const other = renderRosterMessage(view({ kind: "other" })).embeds[0]!;
  assert.ok(other.description!.includes("**PvP** ·"));
  assert.equal(other.color, 0x2b4db0);
  const boss = renderRosterMessage(view({ type: "pve", kind: "world-boss" })).embeds[0]!;
  assert.ok(boss.description!.includes("**PvE · World boss**"));
  assert.equal(boss.color, 0xd4a017);
  assert.equal(renderRosterMessage(view({ kind: "nonsense" })).embeds[0]!.color, 0x2b4db0);
  assert.equal(renderRosterMessage(view({ kind: "zvz", status: "cancelled" })).embeds[0]!.color, 0x6b6b6b);
});

test("a duty shows after the weapon, on held and open positions alike", () => {
  const withDuty = view({ slots: [
    { id: "s1", position: 1, role: "Tank", weapon: "Axe", userId: "111", duty: "caller" },
    { id: "s2", position: 2, role: "Healer", weapon: "Holy", userId: null, duty: "scout" },
    { id: "s3", position: 3, role: "DPS", weapon: "Bow", userId: "222", duty: "rat" },
    { id: "s4", position: 4, role: "DPS", weapon: "Bow", userId: "333", duty: "bogus" },
  ] });
  const d = desc(withDuty);
  assert.ok(d.includes("1. Tank - Axe · 📯 Caller · sworn: <@111>"));
  assert.ok(d.includes("2. Healer - Holy · 🏹 Scout · open"));
  assert.ok(d.includes("3. DPS - Bow · 🐀 Rat · sworn: <@222>"));
  assert.ok(d.includes("4. DPS - Bow · sworn: <@333>\n"));
});

test("every icon used on a button is a real emoji Discord accepts (a dingbat such as a heavy cross is not)", () => {
  for (const role of ["Tank", "Healer", "Support", "DPS", "Off-Tank", "Scout", "Caller", "Ranged DPS", "Mage", "Whatever"]) {
    const icon = roleIcon(role);
    assert.ok(/\p{Emoji_Presentation}|\uFE0F/u.test(icon), `${role}: ${icon}`);
  }
  assert.ok(!/\u271A/.test(["Tank", "Healer", "Support", "DPS"].map(roleIcon).join("")));
  const rows = renderRosterMessage(view({ slots: ["Tank", "Healer", "Support", "DPS"].map((role, i) => ({ id: `s${i}`, position: i + 1, role, weapon: "W", userId: null })) })).components as any[];
  for (const b of rows.flatMap((r) => r.components).filter((c: any) => c.emoji)) {
    assert.ok(/\p{Emoji_Presentation}|\uFE0F/u.test(b.emoji.name), b.emoji.name);
  }
});
