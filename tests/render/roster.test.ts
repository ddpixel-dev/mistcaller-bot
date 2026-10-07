import { test } from "node:test";
import assert from "node:assert/strict";
import { IS_COMPONENTS_V2, escapeText, formatUtc, renderRosterMessage, voteLine } from "../../src/render/roster.ts";
import { fillBar, roleIcon } from "../../src/render/theme.ts";
import type { RosterSlot, RosterView } from "../../src/domain/types.ts";
import { discordProblems, flatComponents, textOf } from "../helpers/discordLimits.ts";
import { WEAPONS } from "../../src/data/weapons.ts";
import { WEAPON_EMOJI } from "../../src/data/weapon-emoji.ts";

function view(over: Partial<RosterView> = {}): RosterView {
  return {
    id: "c1", guildId: "g1", threadId: "t1", messageId: null, type: "pvp", kind: "other",
    title: "Ava roam", notes: null,
    startsAt: new Date("2026-10-07T18:00:00Z"),
    tier: { min: { tier: 5, enchant: 3 }, max: { tier: 7, enchant: 0 } },
    hasLoot: true, status: "open",
    slots: [
      { id: "s1", position: 1, role: "Tank", weapon: "Broadsword", userId: "111" },
      { id: "s2", position: 2, role: "Healer", weapon: "Great Holy Staff", userId: null },
    ],
    votes: { split: 0, regear: 0 }, voteClosed: false, voteResult: null, started: false,
    ...over,
  };
}
const slots = (n: number, filled: number, role = "DPS", weapon = "Bow"): RosterSlot[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, position: i + 1, role, weapon, userId: i < filled ? `${100 + i}` : null }));
const msg = (v: RosterView) => renderRosterMessage(v);
const txt = (v: RosterView) => textOf(msg(v));
const comps = (v: RosterView) => flatComponents(msg(v));
const byId = (v: RosterView, prefix: string) => comps(v).filter((c) => String(c.custom_id ?? "").startsWith(prefix));

test("formatUtc", () => {
  assert.equal(formatUtc(new Date("2026-10-07T18:00:00Z")), "Wed 7 Oct 2026, 18:00 UTC");
});

test("escapeText", () => {
  assert.equal(escapeText("\\*_~`|>#[]@a"), "\\\\\\*\\_\\~\\`\\|\\>\\#\\[\\]@​a");
});

test("escapeText neutralises masked links, timestamps, custom emoji and autolinks", () => {
  const z = "​";
  assert.equal(escapeText("[x](http://evil)"), "\\[x\\](http://evil)");
  assert.equal(escapeText("<t:1:F>"), `<${z}t:1:F\\>`);
  assert.equal(escapeText("<:emoji:123>"), `<${z}:emoji:123\\>`);
  assert.equal(escapeText("<http://evil.example>"), `<${z}http://evil.example\\>`);
});

test("a roster is a Components V2 message: flag, one coloured container, no embeds and no content, no pings", () => {
  const m: any = msg(view());
  assert.equal(m.flags & IS_COMPONENTS_V2, IS_COMPONENTS_V2);
  assert.equal(m.embeds, undefined);
  assert.equal(m.content, undefined);
  assert.equal(m.components.length, 1);
  assert.equal(m.components[0].type, 17);
  assert.deepEqual(m.allowed_mentions, { parse: [] });
});

test("header lines: category, tier and loot vote each on their own line with an icon, then UTC and your time", () => {
  const lines = txt(view({ kind: "zvz" })).split("\n");
  assert.ok(lines.includes("⚔️ **PvP · ZvZ**"));
  assert.ok(lines.includes("🛡️ **Tier:** T5.3–T7.0"));
  assert.ok(lines.some((l) => l.startsWith("💰 **Loot vote:** On")));
  assert.ok(lines.includes("🕰️ **UTC** · Wed 7 Oct 2026, 18:00 UTC"));
  assert.ok(lines.includes("🌍 **Your time** · <t:1791396000:f> · <t:1791396000:R>"));
  assert.ok(lines.some((l) => l.startsWith("**The Company (1/2)**")));
  assert.ok(lines[0]!.startsWith("**📜 ⚜ Ava roam ⚜"));
});

test("no loot and single tier", () => {
  const t = txt(view({ hasLoot: false, tier: { min: { tier: 5, enchant: 3 }, max: null } }));
  assert.ok(t.includes("💰 **Loot vote:** Off"));
  assert.ok(t.includes("🛡️ **Tier:** T5.3\n"));
  assert.ok(!t.includes("T5.3–"));
});

test("the loot vote line carries the tally and closing time while open, and the result on the same line after", () => {
  const open = txt(view({ votes: { split: 3, regear: 2 } })).split("\n").find((l) => l.includes("Loot vote"))!;
  assert.equal(open, "💰 **Loot vote:** On · Split 3 · Regear 2 · closes <t:1791395700:R>");
  const cases: [Partial<RosterView>, string][] = [
    [{ votes: { split: 3, regear: 2 }, voteResult: "split" }, "Result: Split won 3-2"],
    [{ votes: { split: 2, regear: 3 }, voteResult: "regear" }, "Result: Regear won 3-2"],
    [{ votes: { split: 2, regear: 2 }, voteResult: "tie" }, "Result: Tie 2-2"],
    [{ votes: { split: 0, regear: 0 }, voteResult: "none" }, "Result: no votes"],
  ];
  for (const [over, expected] of cases) {
    const line = txt(view({ voteClosed: true, ...over })).split("\n").find((l) => l.includes("Loot vote"))!;
    assert.equal(line, `💰 **Loot vote:** On · ${expected}`);
    assert.ok(!line.includes("closes"));
  }
  assert.equal(txt(view({ voteClosed: true, votes: { split: 1, regear: 0 }, voteResult: "split" })).split("Loot vote").length, 2);
  assert.equal(voteLine(view({ voteClosed: true, votes: { split: 2, regear: 1 }, voteResult: "split" })), "💰 Loot vote result: Split won 2-1");
});

test("a roster row reads: number, role icon, role - weapon - duty, then Sworn: player or Open", () => {
  // Weapons without an icon (not in the list) show only their name, so the text format is easy to read here.
  const t = txt(view({ slots: [
    { id: "s1", position: 1, role: "Tank", weapon: "Mystery Axe", userId: "111", duty: "caller" },
    { id: "s2", position: 2, role: "Healer", weapon: "Mystery Staff", userId: null, duty: "scout" },
    { id: "s3", position: 3, role: "DPS", weapon: "Mystery Bow", userId: "222" },
    { id: "s4", position: 4, role: "Support", weapon: "Mystery Orb", userId: null },
  ] }));
  assert.ok(t.includes("1. 🛡️ Tank - Mystery Axe - 📯 Caller · Sworn: <@111>"));
  assert.ok(t.includes("2. 💚 Healer - Mystery Staff - 🏹 Scout · Open"));
  assert.ok(t.includes("3. ⚔️ DPS - Mystery Bow · Sworn: <@222>"));
  assert.ok(t.includes("4. ✨ Support - Mystery Orb · Open"));
});

test("the weapon icon sits inline before the weapon name when its emoji exists, and not when it does not", () => {
  const withIds = Object.keys(WEAPON_EMOJI).length;
  assert.ok(withIds > 100, "run scripts/sync-emoji.ts");
  const known = WEAPONS.find((w) => w.name === "Broadsword" && WEAPON_EMOJI[w.base])!;
  const t = txt(view({ slots: [{ id: "s1", position: 1, role: "Tank", weapon: "Broadsword", userId: null }, { id: "s2", position: 2, role: "Tank", weapon: "Mystery Blade", userId: null }] }));
  assert.ok(t.includes(`1. 🛡️ Tank - <:w_${known.base}:${WEAPON_EMOJI[known.base]}> Broadsword · Open`));
  assert.ok(t.includes("2. 🛡️ Tank - Mystery Blade · Open"));
});

test("user text is escaped in the title, notes, role and weapon, and nothing can ping", () => {
  const t = txt(view({ title: "@everyone **x**", notes: "@here *hi*", slots: [{ id: "s", position: 1, role: "_R_", weapon: "@W", userId: null }] }));
  assert.ok(t.includes("@​everyone \\*\\*x\\*\\*"));
  assert.ok(t.includes("@​here \\*hi\\*"));
  assert.ok(t.includes("\\_R\\_ - @​W"));
  assert.deepEqual((msg(view()) as any).allowed_mentions, { parse: [] });
});

test("notes get a Notes: label and a different icon than the title", () => {
  const t = txt(view({ notes: "bring food" }));
  assert.ok(t.includes("📝 **Notes:** bring food"));
  assert.ok(!t.split("\n").slice(1).some((l) => l.includes("📜")));
});

test("colour comes from the category, grey when cancelled or done", () => {
  const color = (v: RosterView) => (msg(v) as any).components[0].accent_color;
  assert.equal(color(view({ kind: "other" })), 0x2b4db0);
  assert.equal(color(view({ kind: "zvz" })), 0x1c3a8a);
  assert.equal(color(view({ type: "pve", kind: "world-boss" })), 0xd4a017);
  assert.equal(color(view({ kind: "zvz", status: "cancelled" })), 0x6b6b6b);
  assert.equal(color(view({ status: "done" })), 0x4a4a4a);
});

test("status shows in the text: cancelled title and banner, closed roll, concluded", () => {
  assert.ok(txt(view({ status: "cancelled" })).startsWith("**✖ CANCELLED — Ava roam**"));
  assert.ok(txt(view({ status: "cancelled" })).includes("Cancelled."));
  assert.ok(txt(view({ status: "done" })).includes("Concluded."));
  assert.ok(txt(view({ status: "locked" })).includes("The roll is closed."));
  assert.ok(!txt(view()).includes("closed"));
});

test("fill bar and role icons", () => {
  assert.equal(fillBar(0, 5), "▱▱▱▱▱▱▱▱▱▱");
  assert.equal(fillBar(5, 5), "▰▰▰▰▰▰▰▰▰▰");
  assert.equal(roleIcon("Tank"), "🛡️");
  assert.equal(roleIcon("Healer"), "💚");
  assert.equal(roleIcon("Support"), "✨");
  assert.equal(roleIcon("DPS"), "⚔️");
  assert.equal(roleIcon("Whatever"), "🔹");
  assert.ok(txt(view({ slots: slots(10, 5) })).includes("▰▰▰▰▰▱▱▱▱▱"));
});

test("the menu lists only the open positions, so a taken one is gone from it", () => {
  const menu = byId(view({ slots: slots(6, 2) }), "join:")[0]!;
  assert.equal(menu.custom_id, "join:c1");
  assert.equal(menu.placeholder, "Pick an open position (4)");
  assert.deepEqual(menu.options.map((o: any) => o.value), ["s3", "s4", "s5", "s6"]);
  assert.ok(menu.options[0].label.startsWith("3. DPS - Bow"));
  const after = byId(view({ slots: slots(6, 3) }), "join:")[0]!;
  assert.deepEqual(after.options.map((o: any) => o.value), ["s4", "s5", "s6"]);
});

test("the menu uses the weapon's emoji when it exists, and the role icon otherwise", () => {
  const known = WEAPONS.find((w) => w.name === "Longbow" && WEAPON_EMOJI[w.base])!;
  const menu = byId(view({ slots: [
    { id: "s1", position: 1, role: "DPS", weapon: "Longbow", userId: null },
    { id: "s2", position: 2, role: "Tank", weapon: "Mystery Blade", userId: null },
  ] }), "join:")[0]!;
  assert.deepEqual(menu.options[0].emoji, { id: WEAPON_EMOJI[known.base], name: `w_${known.base}` });
  assert.deepEqual(menu.options[1].emoji, { name: "🛡️" });
});

test("no menu when the roster is full, closed, started, cancelled or done", () => {
  assert.equal(byId(view({ slots: slots(4, 4) }), "join:").length, 0);
  for (const over of [{ status: "locked" }, { status: "cancelled" }, { status: "done" }, { started: true }] as const) {
    assert.equal(byId(view({ ...over, slots: slots(4, 1) }), "join:").length, 0, JSON.stringify(over));
  }
  assert.equal(byId(view({ slots: slots(4, 1) }), "join:").length, 1);
});

test("one shared Leave button for every party size: enabled while anyone is signed up, no per-row buttons", () => {
  for (const n of [1, 5, 11, 12, 20]) {
    const v = view({ slots: slots(n, 1) });
    assert.equal(comps(v).filter((c) => c.type === 9).length, 0, `n=${n}`);
    const leave = byId(v, "leave:c1");
    assert.equal(leave.length, 1, `n=${n}`);
    assert.deepEqual(leave[0], { type: 2, style: 4, label: "Leave", emoji: { name: "🚪" }, custom_id: "leave:c1", disabled: false });
    assert.equal(byId(v, "leaveslot:").length, 0);
  }
  assert.equal(byId(view({ slots: slots(8, 0) }), "leave:c1")[0]!.disabled, true);
});

test("the shared Leave stays on when locked or started, and is dimmed when cancelled or done", () => {
  assert.equal(byId(view({ slots: slots(4, 2), status: "locked" }), "leave:c1")[0]!.disabled, false);
  assert.equal(byId(view({ slots: slots(4, 2), started: true }), "leave:c1")[0]!.disabled, false);
  for (const status of ["cancelled", "done"] as const) {
    assert.equal(byId(view({ slots: slots(4, 2), status }), "leave:c1")[0]!.disabled, true);
  }
});

test("all rows sit in one text block; Leave and the vote buttons share the last row", () => {
  const v = view({ slots: slots(20, 7), hasLoot: true });
  assert.equal(txt(v).split("\n").filter((l) => /^\d+\. /.test(l)).length, 20);
  const rows = comps(v).filter((c) => c.type === 1);
  const last = rows[rows.length - 1]!;
  assert.deepEqual(last.components.map((c: any) => c.custom_id), ["leave:c1", "vote:c1:split", "vote:c1:regear"]);
  assert.deepEqual(byId(view({ hasLoot: false }), "leave:c1").length, 1);
});

test("vote buttons: counts, styles and ids; dimmed after the cutoff, when cancelled or done", () => {
  const open = byId(view({ votes: { split: 3, regear: 2 } }), "vote:");
  assert.deepEqual(open, [
    { type: 2, style: 1, label: "Split (3)", custom_id: "vote:c1:split", disabled: false },
    { type: 2, style: 3, label: "Regear (2)", custom_id: "vote:c1:regear", disabled: false },
  ]);
  assert.ok(byId(view({ voteClosed: true }), "vote:").every((b) => b.disabled));
  for (const status of ["cancelled", "done"] as const) assert.ok(byId(view({ status }), "vote:").every((b) => b.disabled));
  assert.ok(byId(view({ status: "locked" }), "vote:").every((b) => !b.disabled));
  assert.equal(byId(view({ hasLoot: false }), "vote:").length, 0);
});

test("every layout stays inside Discord's limits: sizes 1 to 20, every state, loot on and off", () => {
  const problems: string[] = [];
  for (let n = 1; n <= 20; n++) {
    for (const filled of [0, Math.floor(n / 2), n]) {
      for (const hasLoot of [true, false]) {
        for (const status of ["open", "locked", "cancelled", "done"] as const) {
          const v = view({ slots: slots(n, filled), hasLoot, status, started: status === "locked" });
          for (const p of discordProblems(msg(v))) problems.push(`n=${n} filled=${filled} loot=${hasLoot} ${status}: ${p}`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("component count stays small at any size: 20 positions with a loot vote and a full role use 11 of 40", () => {
  const count = (v: RosterView) => {
    const n = (c: any): number => 1 + (c.components ?? []).reduce((a: number, x: any) => a + n(x), 0) + (c.accessory ? 1 : 0);
    return n((msg(v) as any).components[0]);
  };
  assert.equal(count(view({ slots: slots(20, 10), hasLoot: true })), 9);
  assert.equal(count(view({ slots: slots(20, 20), hasLoot: true })), 9);
});

test("worst case text: 20 slots with the longest roles and weapons and a long note still fits 4000 characters", () => {
  const long = Array.from({ length: 20 }, (_, i) => ({
    id: `s${i}`, position: i + 1, role: "R".repeat(30), weapon: WEAPONS[i]!.name.padEnd(40, "x").slice(0, 40), userId: "123456789012345678", duty: "caller",
  }));
  const v = view({ slots: long, title: "T".repeat(100), notes: "N".repeat(500), hasLoot: true });
  assert.ok(txt(v).length <= 4000, String(txt(v).length));
  assert.deepEqual(discordProblems(msg(v)), []);
  assert.ok(txt(v).includes("The Company (20/20)"));
});

test("the waitlist shows its members in order with the role they wait for, and nothing when empty", () => {
  const v = view({ slots: slots(4, 4, "Healer", "Holy Staff"), waitlist: [{ userId: "901", role: "Healer" }, { userId: "902", role: "Tank" }] });
  assert.ok(txt(v).includes("🕒 **Waitlist (2):** 1. <@901> (Healer) · 2. <@902> (Tank)"));
  assert.ok(!txt(view()).includes("Waitlist"));
  assert.deepEqual(discordProblems(msg(v)), []);
});

test("a menu to join the waitlist lists only the roles with no open position", () => {
  const mixed = view({ slots: [
    { id: "s1", position: 1, role: "Tank", weapon: "Mace", userId: "1" },
    { id: "s2", position: 2, role: "Healer", weapon: "Holy", userId: "2" },
    { id: "s3", position: 3, role: "Healer", weapon: "Fallen", userId: null },
    { id: "s4", position: 4, role: "DPS", weapon: "Bow", userId: "3" },
    { id: "s5", position: 5, role: "DPS", weapon: "Bow", userId: "4" },
  ], waitlist: [{ userId: "9", role: "DPS" }] });
  const menu = byId(mixed, "wait:")[0]!;
  assert.equal(menu.custom_id, "wait:c1");
  assert.deepEqual(menu.options.map((o: any) => o.value), ["Tank", "DPS"]);
  assert.deepEqual(menu.options.map((o: any) => o.description), ["0 waiting", "1 waiting"]);
  assert.ok(menu.options[0].label.startsWith("Tank (all taken)"));
  assert.equal(byId(view({ slots: slots(4, 2) }), "wait:").length, 0);
  for (const over of [{ status: "locked" }, { status: "cancelled" }, { status: "done" }, { started: true }] as const) {
    assert.equal(byId(view({ ...over, slots: slots(4, 4) }), "wait:").length, 0, JSON.stringify(over));
  }
  assert.deepEqual(discordProblems(msg(mixed)), []);
});

test("Leave is enabled for someone who is only on the waitlist", () => {
  const onlyWaiting = view({ slots: slots(3, 0), waitlist: [{ userId: "9", role: "DPS" }] });
  assert.equal(byId(onlyWaiting, "leave:c1")[0]!.disabled, false);
  assert.equal(byId(view({ slots: slots(3, 0) }), "leave:c1")[0]!.disabled, true);
});

test("the waitlist text and the menus stay inside Discord's limits with 20 positions and a long waitlist", () => {
  const waiting = Array.from({ length: 30 }, (_, i) => ({ userId: `${900000000000000000 + i}`, role: "R".repeat(30) }));
  const v = view({ slots: slots(20, 20, "R".repeat(30), "Great Axe"), waitlist: waiting, hasLoot: true });
  assert.deepEqual(discordProblems(msg(v)), []);
  assert.ok(txt(v).length <= 4000);
});
