import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSchedule, EVENTS_PER_MESSAGE, type ScheduleEvent } from "../../src/render/schedule.ts";
import { discordProblems, plain, textOf } from "../helpers/discordLimits.ts";

// Thursday 15 October 2026, 12:00 UTC
const NOW = new Date("2026-10-15T12:00:00Z");
const H = 3600000;
let n = 0;
const event = (over: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  id: `e${++n}`, threadId: `10000000000000${String(n).padStart(4, "0")}`, messageId: `20000000000000${String(n).padStart(4, "0")}`,
  title: `Event ${n}`, type: "pvp", kind: "zvz", startsAt: new Date(NOW.getTime() + 2 * H), status: "open", party: 3, total: 10, ...over,
});
const at = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 9, 15 + day, hour, minute));
const render = (events: ScheduleEvent[], stamp = NOW) => renderSchedule(events, "g1", NOW, stamp) as any[];
const all = (bodies: any[]) => bodies.map((b) => plain(textOf(b))).join("\n=====\n");

test("an empty calendar says so and how to start an event", () => {
  const bodies = render([]);
  assert.equal(bodies.length, 1);
  const t = all(bodies);
  assert.ok(t.includes("Events Calendar"));
  assert.ok(t.includes("No live or upcoming events") && t.includes("/content create"));
  assert.deepEqual(discordProblems(bodies[0]), []);
});

test("only the days that have events get a section, in date order; days without events are left out", () => {
  const t = all(render([event({ startsAt: at(2, 20) }), event({ startsAt: at(0, 18) }), event({ startsAt: at(2, 9) })]));
  const heads = t.split("\n").filter((l) => l.startsWith("### "));
  assert.deepEqual(heads, ["### 📆 Thu 15 Oct · Today", "### 📆 Sat 17 Oct"]);
  assert.ok(!t.includes("Nothing planned") && !t.includes("Fri 16 Oct"), "the empty Friday is not shown");
  assert.ok(t.includes("Events Calendar") && !t.includes("Event calendar"));
});

test("the day tags say Today and Tomorrow, and the window is 7 days", () => {
  const t = all(render([event({ startsAt: at(1, 18) }), event({ startsAt: at(6, 18) }), event({ startsAt: at(7, 18) })]));
  const heads = t.split("\n").filter((l) => l.startsWith("### "));
  assert.deepEqual(heads, ["### 📆 Fri 16 Oct · Tomorrow", "### 📆 Wed 21 Oct"], "the 8th day is outside the window");
});

test("an event shows its UTC time as a column, its title, its party, your time, and a roster link, on the right day", () => {
  const e = event({ title: "Ava *raid*", startsAt: at(1, 18, 30), party: 7, total: 10, type: "pve", kind: "group-dungeon", status: "locked" });
  const t = all(render([e]));
  const lines = t.split("\n");
  const i = lines.findIndex((l) => l.includes("Ava \\*raid\\*"));
  assert.ok(lines[i]!.startsWith("`18:30` 🐉 **Ava \\*raid\\***"), lines[i]);
  assert.ok(lines[i]!.includes(`[Open ↗](https://discord.com/channels/g1/${e.threadId}/${e.messageId})`));
  const detail = lines[i + 1]!;
  assert.ok(detail.includes("PvE · Group dungeon") && detail.includes("👥 7/10") && detail.includes("🔒"), detail);
  const epoch = Math.floor(e.startsAt.getTime() / 1000);
  assert.ok(detail.includes(`<t:${epoch}:t>`) && detail.includes(`<t:${epoch}:R>`), "local time and relative time");
  assert.ok(t.indexOf("Fri 16 Oct") < t.indexOf("Ava"), "listed under Friday");
  assert.ok(!t.includes("Sat 17 Oct"), "and no empty days after it");
});

test("events within a day are in time order; events already running sit above the days under Live now", () => {
  const late = event({ title: "Late", startsAt: at(0, 22) });
  const early = event({ title: "Early", startsAt: at(0, 14) });
  const running = event({ title: "Running", startsAt: new Date(NOW.getTime() - 45 * 60000) });
  const t = all(render([late, running, early]));
  assert.ok(t.indexOf("Live now") < t.indexOf("Running") && t.indexOf("Running") < t.indexOf("Thu 15 Oct"));
  assert.ok(t.indexOf("Early") < t.indexOf("Late"));
});

test("a roster without a message id links to its post, and events beyond the 7 days are not shown", () => {
  const e = event({ messageId: null });
  const far = event({ title: "Far away", startsAt: at(8, 18) });
  const t = all(render([e, far]));
  assert.ok(t.includes(`https://discord.com/channels/g1/${e.threadId})`));
  assert.ok(!t.includes("Far away"));
});

test("more than 12 events continue in a second message that repeats the day heading, and each fits Discord's limits", () => {
  const events = Array.from({ length: EVENTS_PER_MESSAGE + 5 }, (_, i) => event({ title: "T".repeat(30), startsAt: at(0, 13, i) }));
  const bodies = render(events);
  assert.equal(EVENTS_PER_MESSAGE, 12);
  assert.equal(bodies.length, 2);
  assert.equal((all([bodies[0]]).match(/Open ↗/g) ?? []).length, 12);
  assert.equal((all([bodies[1]]).match(/Open ↗/g) ?? []).length, 5);
  assert.ok(all([bodies[1]]).includes("continued") && all([bodies[1]]).includes("Thu 15 Oct · Today (cont.)"));
  for (const b of bodies) assert.deepEqual(discordProblems(b), []);
  assert.equal(render(events.slice(0, 12)).length, 1, "exactly 12 stay in one message");
});

test("titles full of markdown characters (escaped, so twice as long) start a new message early, so no message goes over Discord's text limit and nothing is lost", () => {
  const events = Array.from({ length: 12 }, (_, i) => event({ title: "*".repeat(100), startsAt: at(0, 13, i) }));
  const bodies = render(events);
  assert.ok(bodies.length >= 2);
  for (const b of bodies) assert.deepEqual(discordProblems(b), []);
  assert.equal(all(bodies).match(/Open ↗/g)!.length, 12);
});

test("the Updated stamp is the only thing that changes between two renders of the same events", () => {
  const events = [event(), event()];
  const a = JSON.stringify(render(events, new Date(0)));
  const b = JSON.stringify(render(events, new Date(60000)));
  assert.notEqual(a, b);
  assert.equal(a.replaceAll(`<t:0:R>`, "X"), b.replaceAll(`<t:60:R>`, "X"));
});

test("the container uses the calendar colour, mentions nobody and is a Components V2 message", () => {
  const b: any = render([event()])[0];
  assert.equal(b.flags, 1 << 15);
  assert.equal(b.components[0].type, 17);
  assert.equal(typeof b.components[0].accent_color, "number");
  assert.deepEqual(b.allowed_mentions, { parse: [] });
});
