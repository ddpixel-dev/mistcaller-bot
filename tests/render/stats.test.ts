import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStats } from "../../src/render/stats.ts";
import type { Stats } from "../../src/db/stats.ts";
import { discordProblems, plain, textOf } from "../helpers/discordLimits.ts";

const NOW = new Date("2026-10-15T12:00:00Z");
const empty: Stats = {
  all: { created: 0, finished: 0, cancelled: 0, participants: 0, signups: 0 }, month: { created: 0, finished: 0, cancelled: 0, participants: 0, signups: 0 },
  byType: { pvp: 0, pve: 0, pvx: 0 }, byKind: [], fillRate: null, busiestDay: null, busiestHour: null, topHosts: [], topPlayers: [],
};
const full: Stats = {
  all: { created: 42, finished: 30, cancelled: 5, participants: 85, signups: 420 }, month: { created: 12, finished: 9, cancelled: 1, participants: 40, signups: 130 },
  byType: { pvp: 20, pve: 15, pvx: 2 },
  byKind: [{ type: "pvp", kind: "zvz", count: 8 }, { type: "pve", kind: "group-dungeon", count: 5 }, { type: "pvp", kind: "other", count: 3 }, { type: "pve", kind: "gold-chest", count: 2 }],
  fillRate: 87, busiestDay: { day: 5, count: 12 }, busiestHour: { hour: 18, count: 9 },
  topHosts: [{ userId: "100000000000000001", count: 12 }, { userId: "100000000000000002", count: 7 }],
  topPlayers: Array.from({ length: 10 }, (_, i) => ({ userId: `20000000000000000${i}`, count: 30 - i })),
};
const render = (s: Stats, stamp = NOW) => renderStats(s, stamp) as any;
const t = (s: Stats) => plain(textOf(render(s)));

test("with no events yet the message says statistics appear after the first one", () => {
  assert.ok(t(empty).includes("Statistics") && t(empty).includes("No events yet"));
  assert.deepEqual(discordProblems(render(empty)), []);
});

test("every number sits on its own line, under a heading per section", () => {
  const lines = t(full).split("\n");
  const has = (line: string) => assert.ok(lines.includes(line), `missing line: ${line}`);
  has("### 🗓️ Events");
  for (const l of ["**All time**", "• Created: **42**", "• Finished: **30**", "• Cancelled: **5**", "**Last 30 days**", "• Created: **12**", "• Finished: **9**", "• Cancelled: **1**"]) has(l);
  has("### ⚔️ By type");
  for (const l of ["• PvP: **20**", "• PvE: **15**", "• PvX: **2**"]) has(l);
  has("### 🏷️ By category");
  for (const l of ["• ZvZ: **8**", "• Group dungeon: **5**", "• Avalonian gold chest: **2**"]) has(l);
  has("### 👥 Players");
  for (const l of ["• Participants: **85**", "• Sign-ups: **420**", "• Participants: **40**", "• Sign-ups: **130**"]) has(l);
  has("**Fill rate**");
  has("• Average of finished events: **87%**");
  has("### ⏰ Busiest");
  has("• Day: **Friday** (12 events)");
  has("• Hour: **18:00 UTC** (9 events)");
  has("### 🏆 Top hosts");
  has("1. <@100000000000000001> · 12 events");
  has("2. <@100000000000000002> · 7 events");
  has("### 🌟 Most joined players");
  has("1. <@200000000000000000> · 30 events");
  has("10. <@200000000000000009> · 21 events");
  assert.ok(!lines.some((l) => (l.match(/\*\*\d/g) ?? []).length > 1), "no line holds more than one number");
});

test("a category that only exists in Other is named by its type, and singular counts read 'event'", () => {
  const x = t({ ...full, topHosts: [{ userId: "100000000000000001", count: 1 }] });
  assert.ok(x.split("\n").includes("• PvP · Other: **3**"), x);
  assert.ok(x.split("\n").includes("1. <@100000000000000001> · 1 event"));
});

test("a long category list is cut and says how many more there are", () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ type: "pvp" as const, kind: i === 0 ? "zvz" : "other", count: 20 - i }));
  const x = t({ ...full, byKind: many });
  assert.ok(x.split("\n").includes("• …and 3 more"));
});

test("optional lines are left out when there is nothing to show", () => {
  const x = t({ ...full, fillRate: null, busiestDay: null, busiestHour: null, topHosts: [] });
  assert.ok(!x.includes("Fill rate") && !x.includes("Busiest") && !x.includes("Top hosts"));
});

test("the footer says who is not counted, nobody is mentioned, and the message fits Discord's limits", () => {
  const b = render(full);
  assert.ok(plain(textOf(b)).includes("players who left a roster are not counted"));
  assert.deepEqual(b.allowed_mentions, { parse: [] });
  assert.equal(b.flags, 1 << 15);
  assert.equal(b.components[0].type, 17);
  assert.deepEqual(discordProblems(b), []);
});

test("the Updated stamp is the only thing that changes between two renders", () => {
  const a = JSON.stringify(render(full, new Date(0)));
  const b = JSON.stringify(render(full, new Date(60000)));
  assert.notEqual(a, b);
  assert.equal(a.replaceAll("<t:0:R>", "X"), b.replaceAll("<t:60:R>", "X"));
});
