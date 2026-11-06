import { flatComponents } from "../helpers/discordLimits.ts";
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
// The calendar pages. The first message of renderSchedule is the creation hub (FR-059), tested on its own below.
const render = (events: ScheduleEvent[], stamp = NOW) => (renderSchedule(events, "g1", NOW, stamp) as any[]).slice(1);
const all = (bodies: any[]) => bodies.map((b) => plain(textOf(b))).join("\n=====\n");

test("an empty calendar says so and how to start an event", () => {
  const bodies = render([]);
  assert.equal(bodies.length, 1);
  const t = all(bodies);
  assert.ok(t.includes("Events Calendar"));
  assert.ok(t.includes("No live or upcoming events") && t.includes("Plan Content"));
  assert.deepEqual(discordProblems(bodies[0]), []);
});

test("only the days that have events get a section, in date order; days without events are left out", () => {
  const t = all(render([event({ startsAt: at(2, 20) }), event({ startsAt: at(0, 18) }), event({ startsAt: at(2, 9) })]));
  const heads = t.split("\n").filter((l) => l.startsWith("## "));
  assert.deepEqual(heads, ["## 📆 Thu 15 Oct · Today", "## 📆 Sat 17 Oct"]);
  assert.ok(!t.includes("Nothing planned") && !t.includes("Fri 16 Oct"), "the empty Friday is not shown");
  assert.ok(t.includes("Events Calendar") && !t.includes("Event calendar"));
});

test("the day tags say Today and Tomorrow, and the window is 7 days", () => {
  const t = all(render([event({ startsAt: at(1, 18) }), event({ startsAt: at(6, 18) }), event({ startsAt: at(7, 18) })]));
  const heads = t.split("\n").filter((l) => l.startsWith("## "));
  assert.deepEqual(heads, ["## 📆 Fri 16 Oct · Tomorrow", "## 📆 Wed 21 Oct"], "the 8th day is outside the window");
});

test("an event shows its UTC time as a column, its title, its party, your time, and a roster link, on the right day", () => {
  const e = event({ title: "Ava *raid*", startsAt: at(1, 18, 30), party: 7, total: 10, type: "pve", kind: "group-dungeon", status: "locked" });
  const t = all(render([e]));
  const lines = t.split("\n");
  const i = lines.findIndex((l) => l.includes("Ava \\*raid\\*"));
  // FR-062: a larger title (a level-3 heading), no emoji in it, and the details in normal-size text.
  assert.ok(lines[i]!.startsWith("### `18:30` Ava \\*raid\\* [Open"), lines[i]);
  assert.ok(!/\p{Extended_Pictographic}/u.test(lines[i]!.replace("↗", "")), "no emoji in the title line");
  assert.ok(lines[i]!.includes(`[Open ↗](https://discord.com/channels/g1/${e.threadId}/${e.messageId})`));
  const detail = lines[i + 1]!;
  assert.ok(!detail.startsWith("-#"), "the details are no longer small subtext");
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

// ---- FR-059, FR-060: the creation buttons, CTA grouping, blank events ----

test("a message of its own above the calendar holds the Plan Content and Schedule CTA buttons", () => {
  for (const events of [[event()], []]) {
    const bodies = renderSchedule(events, "g1", NOW, NOW) as any[];
    const buttons = flatComponents(bodies[0]).filter((c) => c.type === 2);
    assert.deepEqual(buttons.map((b) => [b.label, b.custom_id, b.style]), [["Plan Content", "hub:n", 3], ["Schedule CTA", "hub:c", 1]]);
    assert.ok(!all(bodies.slice(1)).includes("Plan Content") || events.length === 0, "the calendar pages have no buttons");
    assert.equal(flatComponents(bodies[1]).filter((c) => c.type === 2).length, 0);
    assert.deepEqual(discordProblems(bodies[0]), []);
  }
  const same = JSON.stringify(renderSchedule([], "g1", NOW, NOW)[0]) === JSON.stringify(renderSchedule([event()], "g2", new Date(NOW.getTime() + 3600000), NOW)[0]);
  assert.ok(same, "the hub message never changes, so refreshing the calendar leaves it as it is");
});

test("under each day, call-to-arms events come first in their own group, then the normal content", () => {
  const t = all(render([
    event({ title: "Normal early", startsAt: at(0, 13) }),
    event({ title: "CTA late", startsAt: at(0, 20), cta: true }),
    event({ title: "Normal only day", startsAt: at(1, 18) }),
    event({ title: "CTA only day", startsAt: at(2, 18), cta: true }),
  ]));
  const today = t.slice(t.indexOf("Thu 15 Oct"), t.indexOf("Fri 16 Oct"));
  assert.ok(today.indexOf("Call to arms") < today.indexOf("CTA late") && today.indexOf("CTA late") < today.indexOf("Content") && today.indexOf("Content") < today.indexOf("Normal early"), today);
  const tomorrow = t.slice(t.indexOf("Fri 16 Oct"), t.indexOf("Sat 17 Oct"));
  assert.ok(!tomorrow.includes("Call to arms") && !tomorrow.includes("Content"), "a day with one kind needs no group labels");
  const third = t.slice(t.indexOf("Sat 17 Oct"));
  assert.ok(third.includes("Call to arms") && third.indexOf("Call to arms") < third.indexOf("CTA only day"));
});

test("a blank event shows no party count", () => {
  const t = all(render([event({ title: "Meet", blank: true, total: 0, party: 0 })]));
  assert.ok(t.includes("Meet") && !t.includes("👥"), t);
});
