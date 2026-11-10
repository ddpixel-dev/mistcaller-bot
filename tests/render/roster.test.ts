import { rosterButton } from "../../src/render/roster.ts";
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
    id: "c1", guildId: "g1", threadId: "t1", messageId: null, type: "pvp", kind: "other", partyCount: 1,
    title: "Ava roam", notes: null,
    startsAt: new Date("2026-10-07T18:00:00Z"),
    tier: "T5.3–T7.0",
    hasLoot: true, status: "open",
    slots: [
      { id: "s1", position: 1, party: 1, role: "Tank", weapon: "Broadsword", userId: "111" },
      { id: "s2", position: 2, party: 1, role: "Healer", weapon: "Great Holy Staff", userId: null },
    ],
    votes: { split: 0, regear: 0 }, voteClosed: false, voteResult: null,
    ...over,
  };
}
const slots = (n: number, filled: number, role = "DPS", weapon = "Bow"): RosterSlot[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, position: i + 1, party: 1, role, weapon, userId: i < filled ? `${100 + i}` : null }));
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
  assert.ok(lines.includes("🏷️ **Type** **PvP · ZvZ**"), "a label icon, not the ⚔️ of the PvP titles");
  assert.ok(lines.includes("⚙️ **Gear tier** T5.3–T7.0"));
  assert.ok(!lines.some((l) => l.includes("Loot vote")), "the loot vote lives on its buttons only (ADR 0028)");
  assert.ok(lines.includes("🕰️ **UTC** Wed 7 Oct 2026, 18:00 UTC"));
  assert.ok(lines.includes("🌍 **Your time** <t:1791396000:f> · <t:1791396000:R>"));
  assert.ok(lines.some((l) => l.startsWith("**Party (1/2)**")));
  assert.equal(lines[0], "## 🏰 Ava roam", "a level-2 heading with the category's icon (ZvZ)");
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
    { id: "s1", position: 1, party: 1, role: "Tank", weapon: "Mystery Axe", userId: "111", duty: "caller" },
    { id: "s2", position: 2, party: 1, role: "Healer", weapon: "Mystery Staff", userId: null, duty: "scout" },
    { id: "s3", position: 3, party: 1, role: "DPS", weapon: "Mystery Bow", userId: "222" },
    { id: "s4", position: 4, party: 1, role: "Support", weapon: "Mystery Orb", userId: null },
  ] }));
  assert.ok(t.includes("1. 🛡️ Tank - Mystery Axe - <@111> - 📯 Caller\n2. 💚 Healer - Mystery Staff - Open - 🔭 Scout\n3. ⚔️ DPS - Mystery Bow - <@222>\n4. 🤝 Support - Mystery Orb - Open"));
});

test("positions keep their order and numbers with no role headings, even when a role repeats apart", () => {
  const t = txt(view({ slots: [
    { id: "s1", position: 1, party: 1, role: "DPS", weapon: "Bow", userId: "111" },
    { id: "s2", position: 2, party: 1, role: "Tank", weapon: "Mace", userId: null },
    { id: "s3", position: 3, party: 1, role: "dps", weapon: "Axe", userId: null },
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
  const t = txt(view({ slots: [{ id: "s1", position: 1, party: 1, role: "Tank", weapon: "Broadsword", userId: null }, { id: "s2", position: 2, party: 1, role: "Tank", weapon: "Mystery Blade", userId: null }] }));
  assert.ok(t.includes(`1. 🛡️ Tank - <:w8_${known.base}:${WEAPON_EMOJI[known.base]}> Broadsword - Open`));
  assert.ok(t.includes("2. 🛡️ Tank - Mystery Blade - Open"));
});

test("user text is escaped in the title, notes, role and weapon, and nothing can ping", () => {
  const t = txt(view({ title: "@everyone **x**", notes: "@here *hi*", slots: [{ id: "s", position: 1, party: 1, role: "_R_", weapon: "@W", userId: null }] }));
  assert.ok(t.includes("@​everyone \\*\\*x\\*\\*"));
  assert.ok(t.includes("@​here \\*hi\\*"));
  assert.ok(t.includes("1. 🔹 \\_R\\_ - @​W - Open"));
  assert.deepEqual((msg(view()) as any).allowed_mentions, { parse: [] });
  // a role like "# big" cannot break out of its row into a heading
  const h = txt(view({ slots: [{ id: "s", position: 1, party: 1, role: "x\n# big", weapon: "Bow", userId: null }] }));
  const headings = h.split("\n").filter((l) => /^#{1,3} /.test(l));
  assert.deepEqual(headings.map((l) => l.split(" ")[0]), ["##"], "only the title is a heading");
});

test("notes get a Notes: label and a different icon than the title", () => {
  const t = txt(view({ notes: "bring food" }));
  assert.ok(t.includes("📝 **Notes:** bring food"));
  assert.ok(t.split("\n").slice(1).some((l) => l.startsWith("📝")));
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
    { id: "s1", position: 1, party: 1, role: "DPS", weapon: "Longbow", userId: null },
    { id: "s2", position: 2, party: 1, role: "Tank", weapon: "Mystery Blade", userId: null },
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

test("all rows sit in one text block; Leave, Tentative and the vote buttons share the first button row, Manage the second", () => {
  const v = view({ slots: slots(20, 7), hasLoot: true });
  assert.equal(txt(v).split("\n").filter((l) => /^\d+\. /.test(l)).length, 20);
  const rows = comps(v).filter((c) => c.type === 1);
  // Six buttons (FR-067 added Tentative) need two rows: a row holds five at most.
  assert.deepEqual(rows.at(-2)!.components.map((c: any) => c.custom_id), ["leave:c1", "tent:c1", "vote:c1:split", "vote:c1:regear", "ping:c1"]);
  assert.deepEqual(rows.at(-1)!.components.map((c: any) => c.custom_id), ["mg:c1"]);
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

test("component count stays small at any size: 20 positions with a loot vote and a full role use 14 of 40", () => {
  const count = (v: RosterView) => {
    const n = (c: any): number => 1 + (c.components ?? []).reduce((a: number, x: any) => a + n(x), 0) + (c.accessory ? 1 : 0);
    return n((msg(v) as any).components[0]);
  };
  assert.equal(count(view({ slots: slots(20, 10), hasLoot: true })), 14);
  assert.equal(count(view({ slots: slots(20, 20), hasLoot: true })), 14, "full roster: the waitlist menu replaces the open-positions menu");
});

test("worst case text: 20 slots with the longest roles and weapons and a long note still fits 4000 characters", () => {
  const long = Array.from({ length: 20 }, (_, i) => ({
    id: `s${i}`, position: i + 1, party: 1, role: "R".repeat(30), weapon: WEAPONS[i]!.name.padEnd(40, "x").slice(0, 40), userId: "123456789012345678", duty: "caller",
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
    { id: "s1", position: 1, party: 1, role: "Tank", weapon: "Mace", userId: "1" },
    { id: "s2", position: 2, party: 1, role: "Healer", weapon: "Holy", userId: "2" },
    { id: "s3", position: 3, party: 1, role: "Healer", weapon: "Fallen", userId: null },
    { id: "s4", position: 4, party: 1, role: "DPS", weapon: "Bow", userId: "3" },
    { id: "s5", position: 5, party: 1, role: "DPS", weapon: "Bow", userId: "4" },
  ], waitlist: [{ userId: "9", role: "DPS" }] });
  const menu = byId(mixed, "wait:")[0]!;
  assert.equal(menu.custom_id, "wait:c1");
  assert.deepEqual(menu.options.map((o: any) => o.value), ["~fill", "Tank", "DPS"], "Fill comes first (FR-057)");
  assert.deepEqual(menu.options.slice(1).map((o: any) => o.description), ["0 waiting", "1 waiting"]);
  assert.ok(menu.options[1].label.startsWith("Tank (all taken)"));
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
  const v = view({ slots: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, position: i + 1, party: 1, role: `Role number ${i} with a long name`, weapon: "Great Arcane Staff of the Mist", userId: String(100000000000000000n + BigInt(i)), duty: "caller" })), notes: "x".repeat(900) });
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
  const v = view({ slots: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, position: i + 1, party: 1, role: `Role ${i} with a long name`, weapon: "Great Arcane Staff of the Mist", userId: String(100000000000000000n + BigInt(i)), duty: "caller" })), notes: "x".repeat(900) });
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
  assert.ok(raw(v).includes("🔁 **Fill (2):** <@111111111111111111> (Any) · <@222222222222222222> (Any)"));
  assert.equal(byId(v, "fa:").length, 0, "Sign up player lives in the Manage panel (ADR 0028)");
  assert.equal(byId(v, "leave:")[0]!.disabled, false, "Leave is enabled by a fill alone");
  assert.equal(byId(v, "ping:")[0]!.disabled, false, "Ping is enabled by a fill alone");
  assert.equal(byId(view({ slots: slots(3, 0) }), "leave:")[0]!.disabled, true);
  // the waitlist line follows the fill line
  const both = raw(view({ slots: slots(2, 0), fills: ["111111111111111111"], waitlist: [{ userId: "333333333333333333", role: "DPS" }] }));
  assert.ok(both.indexOf("🔁") < both.indexOf("🕒"));
  assert.deepEqual(discordProblems(msg(v)), []);
});

test("two button rows at most: Leave, Tentative, Split, Regear, Ping players, then Manage; Manage stays on finished content, not on cancelled", () => {
  const v = view({ slots: slots(3, 1), hasLoot: true, fills: ["111111111111111111"], waitlist: [{ userId: "901", role: "DPS" }] });
  const rows = (msg(v) as any).components[0].components.filter((c: any) => c.type === 1 && c.components[0].type === 2);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].components.map((c: any) => c.label), ["Leave", "Tentative", "Split (0)", "Regear (0)", "Ping players"]);
  assert.deepEqual(rows[1].components.map((c: any) => c.label), ["Manage"]);
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
    { id: "a", position: 1, party: 1, role: "Tank", weapon: "", userId: null },
    { id: "b", position: 2, party: 1, role: "Tank", weapon: "", userId: "111111111111111111", chosenWeapon: "Broadsword" },
    { id: "c", position: 3, party: 1, role: "Healer", weapon: "", userId: "222222222222222222" },
    { id: "d", position: 4, party: 1, role: "DPS", weapon: "", duty: "caller", userId: null },
  ] });
  const t = raw(v);
  assert.ok(t.includes("1. 🛡️ Tank - Player's choice - Open"));
  assert.ok(t.includes(`2. 🛡️ Tank - <:w8_${known.base}:${WEAPON_EMOJI[known.base]}> Broadsword - <@111111111111111111>`));
  assert.ok(t.includes("3. 💚 Healer - Player's choice - <@222222222222222222>"));
  assert.ok(t.includes("4. ⚔️ DPS - Player's choice - Open - 📯 Caller"));
  const menu = byId(v, "join:")[0]!;
  assert.deepEqual(menu.options.map((o: any) => o.label), ["Fill (choose what you can play)", "1. Tank", "4. DPS - Caller"]);
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

// ---- FR-057: no reserved seats ----

test("the party count is the seated players; a waiting fill holds no seat", () => {
  const withFill = view({ slots: slots(10, 7), fills: ["9001"] });
  assert.ok(txt(withFill).includes("Party (7/10)"), txt(withFill));
  const many = view({ slots: slots(10, 7), fills: ["9001", "9002", "9003", "9004", "9005"] });
  assert.ok(txt(many).includes("Party (7/10)"));
});

test("the join menu lists every open position whatever the fills; the waitlist menu offers Fill first, then the full roles", () => {
  const two = [...slots(2, 1, "Tank", "Mace"), ...slots(2, 1, "DPS", "Bow").map((s, n) => ({ ...s, id: `d${n}`, position: n + 3, party: 1, userId: n === 0 ? "7" : null }))];
  const waitingFills = view({ slots: two, fills: ["9001", "9002"] });
  assert.equal(byId(waitingFills, "join:").length, 1, "nothing is held back for a fill");
  assert.deepEqual(byId(waitingFills, "wait:").length, 0, "every role still has an open position, so no waitlist menu");
  const full = view({ slots: [...slots(2, 2, "Tank", "Mace"), ...slots(2, 2, "DPS", "Bow").map((s, n) => ({ ...s, id: `d${n}`, position: n + 3 }))] });
  assert.equal(byId(full, "join:").length, 0);
  const wait = byId(full, "wait:")[0]!;
  assert.deepEqual(wait.options.map((o: any) => o.value), ["~fill", "Tank", "DPS"]);
  assert.deepEqual(discordProblems(msg(full)), []);
});

test("a waiting fill is listed with what they asked for", () => {
  const v = view({ slots: slots(3, 1), fills: ["9001", "9002"], fillWants: { "9001": "Healer, #7", "9002": "Any" } });
  assert.ok(raw(v).includes("🔁 **Fill (2):** <@9001> (Healer, \\#7) · <@9002> (Any)"), raw(v));
});

// ---- the party strip was removed (ADR 0029): each row already shows its weapon icon ----

test("there is no line of only weapon icons; the icons sit on the position lines", () => {
  const known = WEAPONS.find((w) => w.name === "Broadsword" && WEAPON_EMOJI[w.base])!;
  const v = view({ slots: [{ id: "a", position: 1, party: 1, role: "Tank", weapon: "Broadsword", userId: null }, { id: "b", position: 2, party: 1, role: "Tank", weapon: "Broadsword", userId: null }] });
  const blocks = (msg(v) as any).components[0].components.filter((c: any) => c.type === 10).map((c: any) => c.content as string);
  assert.ok(!blocks.some((b: string) => b.split("\n").some((l) => /^#* *(<a?:\w+:\d+> ?)+$/.test(l))), "no icon-only line");
  assert.equal(txt(v).split(`<:w8_${known.base}:`).length - 1, 2, "one icon per position line, nothing more");
});

test("the title carries one icon: the category's, or the type's for Other; a cancelled title keeps its tag", () => {
  const title = (over: Partial<RosterView>) => txt(view(over)).split("\n")[0];
  assert.equal(title({ kind: "hellgate" }), "## 🔥 Ava roam");
  assert.equal(title({ type: "pve", kind: "mists" }), "## 🌫️ Ava roam");
  assert.equal(title({ kind: "other" }), "## ⚔️ Ava roam");
  assert.equal(title({ type: "pve", kind: "other" }), "## 🐉 Ava roam");
  assert.equal(title({ type: "pvx", kind: "other" }), "## 🌀 Ava roam");
  assert.equal(title({ type: "pvx", kind: "gank-squad" }), "## 🗡️ Ava roam");
  assert.ok(title({ status: "cancelled" }).startsWith("## ✖ CANCELLED — Ava roam"));
});

test("role icons: DTank has its own brick, Tank its shield, a Scout role the telescope, bows keep the bow", () => {
  assert.equal(roleIcon("DTank"), "🧱");
  assert.equal(roleIcon("dtank"), "🧱");
  assert.equal(roleIcon("Tank"), "🛡️");
  assert.equal(roleIcon("Scout"), "🔭");
  assert.equal(roleIcon("Bow"), "🏹");
});

// ---- FR-058: selection mode ----

test("a selection event says so in the post, lists the applicants with what they asked for, and has no waitlist menu", () => {
  const v = view({ slots: slots(3, 3), selection: true, applicants: [{ userId: "9001", wants: "Healer, #7" }, { userId: "9002", wants: "Any" }] });
  assert.ok(raw(v).includes("⚠️ **Disclaimer:** the host picks the party."));
  assert.ok(raw(v).includes("\n\n📨 **Applicants"), "a blank line sets the applicants apart from the players");
  assert.ok(raw(v).includes("📨 **Applicants (2):** <@9001> (Healer, \\#7) · <@9002> (Any)"), raw(v));
  assert.equal(byId(v, "wait:").length, 0, "nobody is seated automatically, so there is nothing to wait for");
  assert.equal(byId(v, "leave:")[0]!.disabled, false, "an applicant can withdraw");
  assert.ok(!raw(view({ slots: slots(3, 1) })).includes("Disclaimer"));
  assert.deepEqual(discordProblems(msg(v)), []);
});

test("in a selection event the join menu is for applying", () => {
  const v = view({ slots: slots(3, 0), selection: true });
  assert.ok(byId(v, "join:")[0]!.placeholder.startsWith("Apply for a position"));
  assert.ok(byId(view({ slots: slots(3, 0) }), "join:")[0]!.placeholder.startsWith("Pick an open position"));
});

test("the roster button is a link button to the roster message, or to the post when the message id is not known", () => {
  const [row] = rosterButton({ guildId: "g1", threadId: "t1", messageId: "m1" }) as any[];
  assert.deepEqual(row.components, [{ type: 2, style: 5, label: "Roster", emoji: { name: "📋" }, url: "https://discord.com/channels/g1/t1/m1" }]);
  assert.equal((rosterButton({ guildId: "g1", threadId: "t1", messageId: null })[0] as any).components[0].url, "https://discord.com/channels/g1/t1");
});

// ---- FR-059, FR-060: CTA and blank content ----

test("a CTA says so in the post", () => {
  const v = view({ cta: true });
  assert.ok(raw(v).includes("📣 **Call to arms**"));
  assert.ok(!raw(view()).includes("Call to arms"));
});

test("a blank content has no roster: no party line, no menus, no Leave, Ping or vote; only Manage", () => {
  const v = view({ blank: true, slots: [], hasLoot: true, notes: "Meet at the portal" });
  const t = txt(v);
  assert.ok(t.includes("Meet at the portal") && t.includes("Gear tier"));
  assert.ok(!t.includes("Party (") && !t.includes("Waitlist"), t);
  assert.equal(comps(v).filter((c) => c.type === 3).length, 0, "no menus");
  const labels = comps(v).filter((c) => c.type === 2).map((c) => c.label);
  assert.deepEqual(labels, ["Manage"]);
  assert.deepEqual(discordProblems(msg(v)), []);
});

test("FR-064: the header names the host with a mention, which shows a name and never pings", () => {
  const t = txt(view({ ownerId: "987654321" }));
  const lines = t.split("\n");
  const type = lines.findIndex((l) => l.includes("**Type**"));
  assert.ok(lines[type + 1]!.startsWith("👑 **Host**") && lines[type + 1]!.endsWith("<@987654321>"), lines[type + 1]);
  assert.deepEqual(msg(view({ ownerId: "987654321" })).allowed_mentions, { parse: [] });
});

test("FR-064: no host line when the content has no known owner", () => {
  assert.ok(!txt(view()).includes("Host"));
  assert.ok(!txt(view({ ownerId: null })).includes("Host"));
});

test("FR-064: a blank content names its host too", () => {
  assert.ok(txt(view({ blank: true, slots: [], ownerId: "55" })).includes("👑 **Host**"));
});

test("FR-067: a tentative player shows ❓ beside their name in a seat, applicants, fill and waitlist", () => {
  const t = txt(view({
    slots: [
      { id: "s1", position: 1, party: 1, role: "Tank", weapon: "Mace", userId: "111" },
      { id: "s2", position: 2, party: 1, role: "Healer", weapon: "Holy", userId: "222" },
    ],
    applicants: [{ userId: "333", wants: "Healer, #2" }, { userId: "444", wants: "Any" }],
    fills: ["555", "666"], fillWants: { "555": "Any", "666": "Tank" },
    waitlist: [{ userId: "777", role: "Healer" }, { userId: "888", role: "Healer" }],
    tentative: ["222", "333", "555", "777"],
  }));
  const row = (n: number) => t.split("\n").find((l) => l.startsWith(`${n}. `))!;
  assert.ok(row(1)!.includes("<@111>") && !row(1)!.includes("❓"), row(1));
  assert.ok(row(2)!.includes("<@222> ❓"), row(2));
  assert.ok(t.includes("<@333> ❓ (Healer") && t.includes("<@444> (Any)"), t);
  assert.ok(t.includes("<@555> ❓ (Any)") && t.includes("<@666> (Tank)"), t);
  assert.ok(t.includes("1. <@777> ❓ (Healer)") && t.includes("2. <@888> (Healer)"), t);
});

test("FR-067: no ❓ anywhere when nobody is tentative", () => {
  assert.ok(!txt(view()).includes("❓"));
  assert.ok(!txt(view({ tentative: [] })).includes("❓"));
});

test("FR-067: a Tentative button sits beside Leave, dimmed like Leave while nobody is signed up", () => {
  const v = view();
  const [leave] = byId(v, "leave:");
  const [tent] = byId(v, "tent:");
  assert.equal(tent!.label, "Tentative");
  assert.deepEqual(tent!.emoji, { name: "❓" });
  assert.equal(tent!.custom_id, "tent:c1");
  assert.equal(tent!.disabled, leave!.disabled);
  const ids = comps(v).filter((c) => c.type === 2).map((c) => String(c.custom_id).split(":")[0]);
  assert.equal(ids.indexOf("tent"), ids.indexOf("leave") + 1, "right after Leave");
  const empty = view({ slots: [{ id: "s1", position: 1, party: 1, role: "Tank", weapon: "Mace", userId: null }] });
  assert.equal(byId(empty, "tent:")[0]!.disabled, true);
  assert.deepEqual(discordProblems(msg(view({ hasLoot: true }))), [], "six buttons fit in two rows");
});

test("FR-067: a finished roster has no live Tentative button", () => {
  assert.equal(byId(view({ status: "done" }), "tent:")[0]?.disabled ?? true, true);
});

test("FR-067: ❓ rows still fit Discord's text limit on a full roster", () => {
  const full = slots(20, 20);
  const v = view({ slots: full, tentative: full.map((s) => s.userId!), notes: "n".repeat(400) });
  assert.deepEqual(discordProblems(msg(v)), []);
});

// ---- Parties of a call to arms (FR-070) ----
import { readFileSync } from "node:fs";
import { ONE_PARTY_VIEWS } from "./fixtures/oneParty.ts";

const SNAPSHOT = JSON.parse(readFileSync(new URL("./fixtures/oneParty.snapshot.json", import.meta.url), "utf8"));

test("one-party content renders byte for byte as before parties existed (captured snapshot)", () => {
  for (const [name, v] of Object.entries(ONE_PARTY_VIEWS)) {
    assert.equal(JSON.stringify(renderRosterMessage(v)), JSON.stringify(SNAPSHOT[name]), name);
    assert.equal(JSON.stringify(renderRosterMessage(v, 1)), JSON.stringify(SNAPSHOT[name]), `${name} (party 1 explicit)`);
  }
});

function twoParty(over: Partial<RosterView> = {}): RosterView {
  const s = (n: number, party: number, role: string, weapon: string, userId: string | null): RosterSlot => ({ id: `s${n}`, position: n, party, role, weapon, userId });
  return view({
    partyCount: 2, cta: true,
    slots: [
      s(1, 1, "Tank", "Mace", "111"), s(2, 1, "Healer", "Holy", null),
      s(3, 2, "DPS", "Bow", "113"), s(4, 2, "Support", "Cursed", null), s(5, 2, "Healer", "Nature", null),
    ],
    waitlist: [{ userId: "201", role: "Tank", party: 1 }, { userId: "202", role: "DPS", party: 2 }],
    fills: ["301", "302"], fillWants: { "301": "Any", "302": "Healer" },
    applicants: [{ userId: "401", wants: "Tank" }, { userId: "402", wants: "DPS" }],
    partyOf: { "202": 2, "302": 2, "402": 2 },
    ...over,
  });
}
const p = (v: RosterView, party: number) => renderRosterMessage(v, party);
const ptxt = (v: RosterView, party: number) => plain(textOf(p(v, party)));
const pcomps = (v: RosterView, party: number) => flatComponents(p(v, party));

test("two parties: party 1 lists only its rows, numbered from 1, with a Party 1 line and its own lists", () => {
  const t = ptxt(twoParty(), 1);
  assert.ok(t.includes("1. "), "row 1");
  assert.ok(t.includes("2. ") && t.includes("Healer - "), "row 2");
  assert.ok(!t.includes("3. "), "no party 2 rows");
  assert.ok(!t.includes("Bow") && !t.includes("Nature"));
  assert.ok(t.split("\n").includes("**Party 1**"));
  assert.ok(t.includes("<@201>") && !t.includes("<@202>"), "waitlist of party 1 only");
  assert.ok(t.includes("<@301>") && !t.includes("<@302>"), "fills of party 1 only");
  assert.ok(t.includes("<@401>") && !t.includes("<@402>"), "applicants of party 1 only");
  assert.ok(t.includes("**Party (1/2)**"), "the party's own count");
  assert.ok(t.includes("**Total** 2/5"), "the content total sits on party 1");
});

test("two parties: party 2 has its heading, rows renumbered from 1, and its own lists", () => {
  const t = ptxt(twoParty(), 2);
  assert.equal(t.split("\n")[0], "## Party 2");
  assert.ok(t.includes("1. ") && t.includes("2. ") && t.includes("3. "));
  assert.ok(t.includes("Bow") && t.includes("Cursed") && t.includes("Nature"));
  assert.ok(!t.includes("Broadsword") && !t.includes("Mace") && !t.includes("Holy"));
  assert.ok(t.includes("<@202>") && !t.includes("<@201>"));
  assert.ok(t.includes("<@302>") && !t.includes("<@301>"));
  assert.ok(t.includes("<@402>") && !t.includes("<@401>"));
  assert.ok(t.includes("**Party (1/3)**"));
  assert.ok(!t.includes("Total"));
  assert.ok(!t.includes("Gear tier") && !t.includes("Tips for the owner"));
});

test("party 2 has the accent colour of the content, no Manage, Ping, vote or tips", () => {
  const v = twoParty();
  assert.equal((p(v, 2) as any).components[0].accent_color, (p(v, 1) as any).components[0].accent_color);
  const ids = pcomps(v, 2).map((c) => String(c.custom_id ?? ""));
  assert.ok(!ids.some((i) => /^(mg|ping|vote):/.test(i)), ids.join());
  assert.ok(ids.includes("leave:c1@2") && ids.includes("tent:c1@2"));
  assert.ok(pcomps(v, 1).some((c) => c.custom_id === "ping:c1") && pcomps(v, 1).some((c) => c.custom_id === "mg:c1"));
});

test("party 2 menu offers only its open positions, numbered from 1; every custom id ends @2; party 1 ids have no suffix", () => {
  const v = twoParty();
  const join = pcomps(v, 2).find((c) => String(c.custom_id).startsWith("join:"))! as any;
  assert.equal(join.custom_id, "join:c1@2");
  assert.deepEqual(join.options.filter((o: any) => o.value !== "fill").map((o: any) => [o.value, o.label.split(" - ")[0]]), [["s4", "2. Support"], ["s5", "3. Healer"]]);
  for (const c of pcomps(v, 2).filter((c) => c.custom_id)) assert.ok(String(c.custom_id).endsWith("@2"), String(c.custom_id));
  const join1 = pcomps(v, 1).find((c) => String(c.custom_id).startsWith("join:"))! as any;
  assert.equal(join1.custom_id, "join:c1");
  assert.deepEqual(join1.options.filter((o: any) => o.value !== "fill").map((o: any) => o.value), ["s2"]);
  for (const c of pcomps(v, 1).filter((c) => c.custom_id)) assert.ok(!String(c.custom_id).includes("@"), String(c.custom_id));
});

test("party 2 waitlist menu lists only party 2's full roles", () => {
  const v = twoParty();
  const wait = pcomps(v, 2).find((c) => String(c.custom_id).startsWith("wait:"))! as any;
  assert.equal(wait.custom_id, "wait:c1@2");
  assert.deepEqual(wait.options.filter((o: any) => o.value !== "~fill").map((o: any) => o.value), ["DPS"]);
  assert.equal(wait.options.find((o: any) => o.value === "DPS").description, "1 waiting");
});

test("two parties of 20 with fills, waitlist and applicants stay under 4000 characters and pass the Discord limits", () => {
  const slotsOf = (party: number) => Array.from({ length: 20 }, (_, i) => ({
    id: `s${(party - 1) * 20 + i + 1}`, position: (party - 1) * 20 + i + 1, party, role: "DPS", weapon: "Bow of Badon with a long name",
    userId: i < 18 ? `${party}${String(i).padStart(17, "0")}` : null,
  }));
  const people = Array.from({ length: 30 }, (_, i) => `9${String(i).padStart(17, "0")}`);
  const v = twoParty({
    slots: [...slotsOf(1), ...slotsOf(2)],
    waitlist: people.slice(0, 10).map((u, i) => ({ userId: u, role: "Healer", party: (i % 2) + 1 })),
    fills: people.slice(10, 20), fillWants: Object.fromEntries(people.slice(10, 20).map((u) => [u, "Healer, #7"])),
    applicants: people.slice(20).map((u) => ({ userId: u, wants: "Tank" })),
    partyOf: Object.fromEntries(people.map((u, i) => [u, (i % 2) + 1])),
    tentative: people.slice(0, 15), notes: "n".repeat(500),
  });
  for (const party of [1, 2]) {
    const m = p(v, party);
    assert.deepEqual(discordProblems(m), [], `party ${party}`);
    assert.ok(textOf(m).length <= 4000, `party ${party}: ${textOf(m).length}`);
  }
});

test("a cancelled or done content greys both parties", () => {
  for (const status of ["cancelled", "done"] as const) {
    const v = twoParty({ status });
    assert.equal((p(v, 1) as any).components[0].accent_color, (p(v, 2) as any).components[0].accent_color, status);
    assert.ok(!pcomps(v, 2).some((c) => String(c.custom_id).startsWith("join:")), "no menu");
    assert.ok(pcomps(v, 2).every((c: any) => c.type !== 2 || c.disabled), `${status}: party 2 buttons disabled`);
    assert.deepEqual(discordProblems(p(v, 2)), []);
  }
});
