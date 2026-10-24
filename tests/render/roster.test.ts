import { test } from "node:test";
import assert from "node:assert/strict";
import { IS_COMPONENTS_V2, escapeText, formatUtc, renderRosterMessage, voteLine } from "../../src/render/roster.ts";
import { fillBar, roleIcon } from "../../src/render/theme.ts";
import type { RosterSlot, RosterView } from "../../src/domain/types.ts";
import { discordProblems, flatComponents, plain, textOf } from "../helpers/discordLimits.ts";
import { WEAPONS } from "../../src/data/weapons.ts";
import { WEAPON_EMOJI } from "../../src/data/weapon-emoji.ts";

function view(over: Partial<RosterView> = {}): RosterView {
  return {
    id: "c1", guildId: "g1", threadId: "t1", messageId: null, type: "pvp", kind: "other",
    title: "Ava roam", notes: null,
    startsAt: new Date("2026-10-07T18:00:00Z"),
    tier: "T5.3–T7.0",
    hasLoot: true, status: "open",
    slots: [
      { id: "s1", position: 1, role: "Tank", weapon: "Broadsword", userId: "111" },
      { id: "s2", position: 2, role: "Healer", weapon: "Great Holy Staff", userId: null },
    ],
    votes: { split: 0, regear: 0 }, voteClosed: false, voteResult: null,
    ...over,
  };
}
const slots = (n: number, filled: number, role = "DPS", weapon = "Bow"): RosterSlot[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, position: i + 1, role, weapon, userId: i < filled ? `${100 + i}` : null }));
const msg = (v: RosterView) => renderRosterMessage(v);
const raw = (v: RosterView) => textOf(msg(v));
const txt = (v: RosterView) => plain(raw(v));
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

test("header lines: category and tier each on their own line with an icon, then UTC and your time; no loot vote line", () => {
  const lines = txt(view({ kind: "zvz" })).split("\n");
  assert.ok(lines.includes("⚔️ **Type** **PvP · ZvZ**"));
  assert.ok(lines.includes("⚙️ **Gear tier** T5.3–T7.0"));
  assert.ok(!lines.some((l) => l.includes("Loot vote")), "the loot vote lives on its buttons only (ADR 0028)");
  assert.ok(lines.includes("🕰️ **UTC** Wed 7 Oct 2026, 18:00 UTC"));
  assert.ok(lines.includes("🌍 **Your time** <t:1791396000:f> · <t:1791396000:R>"));
  assert.ok(lines.some((l) => l.startsWith("**Party (1/2)**")));
  assert.ok(lines[0]!.startsWith("## 📜 ⚜ Ava roam ⚜"), "the title is a level-2 heading");
  assert.ok(lines[1]!.includes("**Type**"), "no gap after the title");
});

test("no loot and single tier", () => {
  const t = txt(view({ hasLoot: false, tier: "T5.3" }));
  assert.ok(!t.includes("Loot vote"));
  assert.ok(t.includes("⚙️ **Gear tier** T5.3\n"));
  assert.ok(!t.includes("T5.3–"));
});

test("the vote result line posted in the thread is unchanged, and the roster text never shows the vote", () => {
  assert.ok(!txt(view({ voteClosed: true, votes: { split: 1, regear: 0 }, voteResult: "split" })).includes("Split won"));
  assert.equal(voteLine(view({ voteClosed: true, votes: { split: 2, regear: 1 }, voteResult: "split" })), "💰 Loot vote result: Split won 2-1");
});

test("one numbered line per position: number, role icon and role, weapon - player - duty (Open for an empty position)", () => {
  // Weapons without an icon (not in the list) show only their name, so the text format is easy to read here.
  const t = txt(view({ slots: [
    { id: "s1", position: 1, role: "Tank", weapon: "Mystery Axe", userId: "111", duty: "caller" },
    { id: "s2", position: 2, role: "Healer", weapon: "Mystery Staff", userId: null, duty: "scout" },
    { id: "s3", position: 3, role: "DPS", weapon: "Mystery Bow", userId: "222" },
    { id: "s4", position: 4, role: "Support", weapon: "Mystery Orb", userId: null },
  ] }));
  assert.ok(t.includes("1. 🛡️ Tank - Mystery Axe - <@111> - 📯 Caller\n2. 💚 Healer - Mystery Staff - Open - 🏹 Scout\n3. ⚔️ DPS - Mystery Bow - <@222>\n4. 🤝 Support - Mystery Orb - Open"));
});

test("positions keep their order and numbers with no role headings, even when a role repeats apart", () => {
  const t = txt(view({ slots: [
    { id: "s1", position: 1, role: "DPS", weapon: "Bow", userId: "111" },
    { id: "s2", position: 2, role: "Tank", weapon: "Mace", userId: null },
    { id: "s3", position: 3, role: "dps", weapon: "Axe", userId: null },
  ] }));
  const lines = t.split("\n");
  assert.ok(!lines.some((l) => l.startsWith("### ")));
  const rows = lines.filter((l) => /^\d+\. /.test(l));
  assert.deepEqual(rows.map((l) => l.split(" - ")[0]), ["1. ⚔️ DPS", "2. 🛡️ Tank", "3. ⚔️ dps"]);
});

test("the weapon icon sits inline before the weapon name when its emoji exists, and not when it does not", () => {
  const withIds = Object.keys(WEAPON_EMOJI).length;
  assert.ok(withIds > 100, "run scripts/sync-emoji.ts");
  const known = WEAPONS.find((w) => w.name === "Broadsword" && WEAPON_EMOJI[w.base])!;
  const t = txt(view({ slots: [{ id: "s1", position: 1, role: "Tank", weapon: "Broadsword", userId: null }, { id: "s2", position: 2, role: "Tank", weapon: "Mystery Blade", userId: null }] }));
  assert.ok(t.includes(`1. 🛡️ Tank - <:w8_${known.base}:${WEAPON_EMOJI[known.base]}> Broadsword - Open`));
  assert.ok(t.includes("2. 🛡️ Tank - Mystery Blade - Open"));
});

test("user text is escaped in the title, notes, role and weapon, and nothing can ping", () => {
  const t = txt(view({ title: "@everyone **x**", notes: "@here *hi*", slots: [{ id: "s", position: 1, role: "_R_", weapon: "@W", userId: null }] }));
  assert.ok(t.includes("@​everyone \\*\\*x\\*\\*"));
  assert.ok(t.includes("@​here \\*hi\\*"));
  assert.ok(t.includes("1. 🔹 \\_R\\_ - @​W - Open"));
  assert.deepEqual((msg(view()) as any).allowed_mentions, { parse: [] });
  // a role like "# big" cannot break out of its row into a heading
  const h = txt(view({ slots: [{ id: "s", position: 1, role: "x\n# big", weapon: "Bow", userId: null }] }));
  const headings = h.split("\n").filter((l) => /^#{1,3} /.test(l));
  assert.deepEqual(headings.map((l) => l.split(" ")[0]), ["##"], "only the title is a heading");
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
  assert.ok(txt(view({ status: "cancelled" })).startsWith("## ✖ CANCELLED — Ava roam"));
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
  assert.equal(roleIcon("Support"), "🤝");
  assert.equal(roleIcon("DPS"), "⚔️");
  assert.equal(roleIcon("Whatever"), "🔹");
  assert.ok(txt(view({ slots: slots(10, 5) })).includes("▰▰▰▰▰▱▱▱▱▱"));
});

test("the menu lists only the open positions, so a taken one is gone from it", () => {
  const menu = byId(view({ slots: slots(6, 2) }), "join:")[0]!;
  assert.equal(menu.custom_id, "join:c1");
  assert.equal(menu.placeholder, "Pick an open position (4)");
  assert.deepEqual(menu.options.map((o: any) => o.value), ["fill", "s3", "s4", "s5", "s6"]);
  assert.ok(menu.options[1].label.startsWith("3. DPS - Bow"));
  const after = byId(view({ slots: slots(6, 3) }), "join:")[0]!;
  assert.deepEqual(after.options.map((o: any) => o.value), ["fill", "s4", "s5", "s6"]);
});

test("the menu uses the weapon's emoji when it exists, and the role icon otherwise", () => {
  const known = WEAPONS.find((w) => w.name === "Longbow" && WEAPON_EMOJI[w.base])!;
  const menu = byId(view({ slots: [
    { id: "s1", position: 1, role: "DPS", weapon: "Longbow", userId: null },
    { id: "s2", position: 2, role: "Tank", weapon: "Mystery Blade", userId: null },
  ] }), "join:")[0]!;
  assert.deepEqual(menu.options[1].emoji, { id: WEAPON_EMOJI[known.base], name: `w8_${known.base}` });
  assert.deepEqual(menu.options[2].emoji, { name: "🛡️" });
});

test("no menu when the roster is full, closed, cancelled or done; a started but open roster keeps its menus", () => {
  assert.equal(byId(view({ slots: slots(4, 4) }), "join:").length, 0);
  const started = view({ slots: slots(4, 1), startsAt: new Date("2020-01-01T00:00:00Z") });
  assert.equal(byId(started, "join:").length, 1);
  assert.ok(!raw(started).includes("The roll is closed."));
  for (const over of [{ status: "locked" }, { status: "cancelled" }, { status: "done" }] as const) {
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
  assert.equal(byId(view({ slots: slots(4, 2), startsAt: new Date("2020-01-01T00:00:00Z") }), "leave:c1")[0]!.disabled, false);
  for (const status of ["cancelled", "done"] as const) {
    assert.equal(byId(view({ slots: slots(4, 2), status }), "leave:c1")[0]!.disabled, true);
  }
});

test("all rows sit in one text block; Leave and the vote buttons share the last row", () => {
  const v = view({ slots: slots(20, 7), hasLoot: true });
  assert.equal(txt(v).split("\n").filter((l) => /^\d+\. /.test(l)).length, 20);
  const rows = comps(v).filter((c) => c.type === 1);
  const last = rows[rows.length - 1]!;
  assert.deepEqual(last.components.map((c: any) => c.custom_id), ["leave:c1", "vote:c1:split", "vote:c1:regear", "ping:c1", "mg:c1"]);
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
          const v = view({ slots: slots(n, filled), hasLoot, status });
          for (const p of discordProblems(msg(v))) problems.push(`n=${n} filled=${filled} loot=${hasLoot} ${status}: ${p}`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("component count stays small at any size: 20 positions with a loot vote and a full role use 12 of 40", () => {
  const count = (v: RosterView) => {
    const n = (c: any): number => 1 + (c.components ?? []).reduce((a: number, x: any) => a + n(x), 0) + (c.accessory ? 1 : 0);
    return n((msg(v) as any).components[0]);
  };
  assert.equal(count(view({ slots: slots(20, 10), hasLoot: true })), 12);
  assert.equal(count(view({ slots: slots(20, 20), hasLoot: true })), 12, "full roster: the waitlist menu replaces the open-positions menu");
});

test("worst case text: 20 slots with the longest roles and weapons and a long note still fits 4000 characters", () => {
  const long = Array.from({ length: 20 }, (_, i) => ({
    id: `s${i}`, position: i + 1, role: "R".repeat(30), weapon: WEAPONS[i]!.name.padEnd(40, "x").slice(0, 40), userId: "123456789012345678", duty: "caller",
  }));
  const v = view({ slots: long, title: "T".repeat(100), notes: "N".repeat(500), hasLoot: true });
  assert.ok(txt(v).length <= 4000, String(txt(v).length));
  assert.deepEqual(discordProblems(msg(v)), []);
  assert.ok(txt(v).includes("Party (20/20)"));
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
  assert.equal(byId(view({ slots: slots(4, 4), startsAt: new Date("2020-01-01T00:00:00Z") }), "wait:").length, 1, "started but open");
  for (const over of [{ status: "locked" }, { status: "cancelled" }, { status: "done" }] as const) {
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

// ---- Header columns (owner decision 2026-10-08): padded with en spaces, measured, approximate ----

test("header labels are followed by the measured number of en spaces, so the values share a column", () => {
  const lines = raw(view({ kind: "zvz" })).split("\n");
  const pad = (name: string) => lines.find((l) => l.includes(`**${name}**`))!.split(`**${name}**`)[1]!.match(/^\u2002*/)![0].length;
  assert.deepEqual(["Type", "Gear tier", "UTC", "Your time"].map(pad), [6, 3, 7, 2]);
  // the shortest labels get the most padding
  assert.ok(pad("UTC") > pad("Gear tier") && pad("Type") > pad("Your time"));
});

test("a full roster of long names still fits Discord's limits", () => {
  const v = view({ slots: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, position: i + 1, role: `Role number ${i} with a long name`, weapon: "Great Arcane Staff of the Mist", userId: String(100000000000000000n + BigInt(i)), duty: "caller" })), notes: "x".repeat(900) });
  assert.deepEqual(discordProblems(msg(v)), []);
  const lines = raw(v).split("\n");
  assert.ok(lines.length > 10);
});

test("all 20 slots show, numbered in order, when the roles repeat", () => {
  const v = view({ slots: [...slots(8, 3, "Tank", "Mace"), ...slots(7, 7, "DPS", "Bow").map((s, i) => ({ ...s, id: `d${i}`, position: 9 + i })), ...slots(5, 0, "Healer", "Holy").map((s, i) => ({ ...s, id: `h${i}`, position: 16 + i }))] });
  const rows = raw(v).split("\n").filter((l) => /^\d+\. /.test(l));
  assert.deepEqual(rows.map((l) => Number(l.split(".")[0])), Array.from({ length: 20 }, (_, i) => i + 1));
});

test("a live roster ends with small tips for the owner; finished or cancelled ones do not", () => {
  const last = (v: RosterView) => {
    const body = (msg(v) as any).components[0].components;
    return body[body.length - 1];
  };
  for (const status of ["open", "locked"] as const) {
    const tail = last(view({ status }));
    assert.equal(tail.type, 10, `${status}: the tips are the last block, below the buttons`);
    assert.ok(tail.content.includes("**Manage**") && tail.content.includes("/content help"));
    assert.ok(!tail.content.includes("/content edit") && !tail.content.includes("/content end"), "the removed commands are not suggested");
    assert.ok(tail.content.split("\n").every((l: string) => l.startsWith("-# ")), "small grey subtext");
  }
  for (const status of ["done", "cancelled"] as const) assert.equal(last(view({ status })).type, 1, `${status}: ends with the buttons`);
  assert.deepEqual(discordProblems(msg(view())), []);
});

test("the tips still fit when the roster text is at Discord's limit", () => {
  const v = view({ slots: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, position: i + 1, role: `Role ${i} with a long name`, weapon: "Great Arcane Staff of the Mist", userId: String(100000000000000000n + BigInt(i)), duty: "caller" })), notes: "x".repeat(900) });
  assert.deepEqual(discordProblems(msg(v)), []);
});

// ---- Spacing (ADR 0028: every gap removed) ----

const SPACER = "-# \u200B"; // the gap line used before 0.22.0

test("there are no gap lines: not after the title or the header, not between rows, not above Fill or Waitlist", () => {
  const v = view({ notes: "bring food", slots: slots(3, 1), fills: ["111111111111111111"], waitlist: [{ userId: "901", role: "DPS" }] });
  const lines = raw(v).split("\n");
  assert.ok(!lines.includes(SPACER));
  assert.ok(!lines.some((l) => l.trim() === "" || l.replace(/[-#\s\u200B]/g, "") === ""), "no blank or invisible line");
  const f = lines.findIndex((l) => l.startsWith("🔁 **Fill"));
  assert.ok(/^\d+\. /.test(lines[f - 1]!) && lines[f + 1]!.startsWith("🕒 **Waitlist"));
});

// ---- Fill, role-only slots and the build line ----

test("fills are listed under the rows; Leave and Ping count a fill; there is no Assign fill button", () => {
  const none = view({ slots: slots(3, 0) });
  assert.ok(!raw(none).includes("🔁"));
  const v = view({ slots: slots(3, 0), fills: ["111111111111111111", "222222222222222222"] });
  assert.ok(raw(v).includes("🔁 **Fill (2):** <@111111111111111111> · <@222222222222222222>"));
  assert.equal(byId(v, "fa:").length, 0, "Sign up player lives in the Manage panel (ADR 0028)");
  assert.equal(byId(v, "leave:")[0]!.disabled, false, "Leave is enabled by a fill alone");
  assert.equal(byId(v, "ping:")[0]!.disabled, false, "Ping is enabled by a fill alone");
  assert.equal(byId(view({ slots: slots(3, 0) }), "leave:")[0]!.disabled, true);
  // the waitlist line follows the fill line
  const both = raw(view({ slots: slots(2, 0), fills: ["111111111111111111"], waitlist: [{ userId: "333333333333333333", role: "DPS" }] }));
  assert.ok(both.indexOf("🔁") < both.indexOf("🕒"));
  assert.deepEqual(discordProblems(msg(v)), []);
});

test("one row of buttons at most: Leave, Split, Regear, Ping players, Manage; Manage stays on finished content, not on cancelled", () => {
  const v = view({ slots: slots(3, 1), hasLoot: true, fills: ["111111111111111111"], waitlist: [{ userId: "901", role: "DPS" }] });
  const rows = (msg(v) as any).components[0].components.filter((c: any) => c.type === 1 && c.components[0].type === 2);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].components.map((c: any) => c.label), ["Leave", "Split (0)", "Regear (0)", "Ping players", "Manage"]);
  assert.equal(byId(v, "mg:")[0]!.custom_id, "mg:c1");
  assert.equal(byId(view({ slots: slots(3, 0), hasLoot: false }), "mg:").length, 1, "Manage shows on an empty roster too");
  assert.equal(byId(view({ status: "locked" }), "mg:").length, 1);
  const done = byId(view({ status: "done" }), "mg:");
  assert.equal(done.length, 1, "finished content keeps Manage for attendance and reopen (ADR 0029)");
  assert.equal(done[0]!.disabled, undefined, "the one control that stays enabled");
  assert.ok(byId(view({ status: "done" }), "leave:").every((c) => c.disabled === true));
  assert.equal(byId(view({ status: "cancelled" }), "mg:").length, 0);
  assert.equal(byId(v, "rm:").length, 0, "Remove player lives in the Manage panel");
});

test("a role-only slot reads Player's choice, then the holder's own weapon with its icon; its menu entry is the role", () => {
  const known = WEAPONS.find((w) => w.name === "Broadsword" && WEAPON_EMOJI[w.base])!;
  const v = view({ slots: [
    { id: "a", position: 1, role: "Tank", weapon: "", userId: null },
    { id: "b", position: 2, role: "Tank", weapon: "", userId: "111111111111111111", chosenWeapon: "Broadsword" },
    { id: "c", position: 3, role: "Healer", weapon: "", userId: "222222222222222222" },
    { id: "d", position: 4, role: "DPS", weapon: "", duty: "caller", userId: null },
  ] });
  const t = raw(v);
  assert.ok(t.includes("1. 🛡️ Tank - Player's choice - Open"));
  assert.ok(t.includes(`2. 🛡️ Tank - <:w8_${known.base}:${WEAPON_EMOJI[known.base]}> Broadsword - <@111111111111111111>`));
  assert.ok(t.includes("3. 💚 Healer - Player's choice - <@222222222222222222>"));
  assert.ok(t.includes("4. ⚔️ DPS - Player's choice - Open - 📯 Caller"));
  const menu = byId(v, "join:")[0]!;
  assert.deepEqual(menu.options.map((o: any) => o.label), ["Fill (play any position)", "1. Tank", "4. DPS - Caller"]);
  assert.deepEqual(menu.options[1].emoji, { name: "🛡️" });
  assert.deepEqual(discordProblems(msg(v)), []);
});

test("with 20 open positions the join menu has 21 entries, and a full roster of fills still fits Discord's limits", () => {
  const menu = byId(view({ slots: slots(20, 0) }), "join:")[0]!;
  assert.equal(menu.options.length, 21);
  const fills = Array.from({ length: 30 }, (_, i) => String(100000000000000000n + BigInt(i)));
  const v = view({ slots: slots(20, 20), fills, waitlist: fills.slice(0, 10).map((u) => ({ userId: u, role: "DPS" })) });
  assert.deepEqual(discordProblems(msg(v)), []);
  assert.ok(raw(v).includes("🔁 **Fill (30):**"));
});

test("the build reference is a header line with a mention (a message shows as a link), right after the gear tier, and absent when not set", () => {
  const lines = raw(view({ buildRef: "123456789012345678" })).split("\n");
  const i = lines.findIndex((l) => l.includes("**Gear tier**"));
  assert.ok(plain(lines[i + 1]!).includes("🧰 **Build** <#123456789012345678>"), plain(lines[i + 1]!));
  assert.ok(!raw(view()).includes("🧰"));
  const pad = lines[i + 1]!.split("**Build**")[1]!.match(/^ */)![0].length;
  assert.ok(pad >= 1);
});

test("a build reference that points at a message shows as a link, not a channel mention", () => {
  const t = plain(raw(view({ buildRef: "123456789012345678/223456789012345678" })));
  assert.ok(t.includes("🧰 **Build**"), t);
  assert.ok(t.includes("[Build message](https://discord.com/channels/g1/123456789012345678/223456789012345678)"), t);
  assert.ok(!t.includes("<#123456789012345678/"), t);
});

// ---- FR-040: fills hold seats ----

test("the party count is seated players plus reserved fills, and the bar follows it", () => {
  const withFill = view({ slots: slots(10, 7), fills: ["9001"] });
  assert.ok(txt(withFill).includes("Party (8/10)"), txt(withFill));
  const many = view({ slots: slots(10, 7), fills: ["9001", "9002", "9003", "9004", "9005"] });
  assert.ok(txt(many).includes("Party (10/10)"), "standby fills hold no seat, so the party never exceeds the positions");
  assert.ok(txt(view({ slots: slots(10, 7) })).includes("Party (7/10)"));
});

test("the join menu closes when every free position is held for a fill; the waitlist menu then offers every role", () => {
  const two = [...slots(2, 1, "Tank", "Mace"), ...slots(2, 1, "DPS", "Bow").map((s, n) => ({ ...s, id: `d${n}`, position: n + 3, userId: n === 0 ? "7" : null }))];
  const open = view({ slots: two, fills: [] });
  assert.equal(byId(open, "join:").length, 1);
  const held = view({ slots: two, fills: ["9001", "9002"] }); // 2 open positions, 2 fills: both held
  assert.equal(byId(held, "join:").length, 0, "no menu: nothing is left to pick");
  const wait = byId(held, "wait:")[0]!;
  assert.deepEqual(wait.options.map((o: any) => o.value), ["Tank", "DPS"], "no Fill on the waitlist menu (ADR 0028); a role with a position that is held can be waited for");
  const spare = view({ slots: two, fills: ["9001"] });
  assert.equal(byId(spare, "join:").length, 1, "2 open positions, 1 fill: one can still be picked");
  assert.deepEqual(byId(spare, "wait:").length, 0);
  assert.deepEqual(discordProblems(msg(held)), []);
});

// ---- the party strip was removed (ADR 0029): each row already shows its weapon icon ----

test("there is no line of only weapon icons; the icons sit on the position lines", () => {
  const known = WEAPONS.find((w) => w.name === "Broadsword" && WEAPON_EMOJI[w.base])!;
  const v = view({ slots: [{ id: "a", position: 1, role: "Tank", weapon: "Broadsword", userId: null }, { id: "b", position: 2, role: "Tank", weapon: "Broadsword", userId: null }] });
  const blocks = (msg(v) as any).components[0].components.filter((c: any) => c.type === 10).map((c: any) => c.content as string);
  assert.ok(!blocks.some((b: string) => b.split("\n").some((l) => /^#* *(<a?:\w+:\d+> ?)+$/.test(l))), "no icon-only line");
  assert.equal(txt(v).split(`<:w8_${known.base}:`).length - 1, 2, "one icon per position line, nothing more");
});
