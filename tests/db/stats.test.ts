import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView } from "../../src/db/content.ts";
import { claimSlot, joinFill } from "../../src/db/signup.ts";
import { getStats } from "../../src/db/stats.ts";

const NOW = new Date("2026-10-15T12:00:00Z");
const DAY = 24 * 3600000;
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function make(over: Record<string, unknown> & { threadId: string; startsAt: Date }) {
  const sql = await testSql();
  const id = await createContent(sql, {
    guildId: "g1", type: "pvp", kind: "zvz", title: over.threadId, notes: null, tier: "T8", hasLoot: false, createdBy: "boss", now: NOW,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "DPS", weapon: "Bow" }], ...over,
  } as any);
  return id;
}
async function seat(id: string, n: number, user: string) {
  const sql = await testSql();
  const slot = (await getRosterView(sql, id, NOW))!.slots[n]!.id;
  await claimSlot(sql, { contentId: id, slotId: slot, userId: user, guildId: "g1", now: NOW });
}

test("with no content every number is zero and the optional ones are null", async () => {
  const s = await getStats(await testSql(), "g1", NOW);
  assert.deepEqual([s.all.created, s.all.participants, s.all.signups, s.month.created], [0, 0, 0, 0]);
  assert.deepEqual([s.fillRate, s.busiestDay, s.busiestHour, s.topHosts, s.topPlayers, s.byKind], [null, null, null, [], [], []]);
});

test("created, finished and cancelled are counted for all time and for the last 30 days", async () => {
  const sql = await testSql();
  const old = await make({ threadId: "old", startsAt: new Date(NOW.getTime() - 60 * DAY) });
  await sql`update content set created_at = ${new Date(NOW.getTime() - 61 * DAY)}, status = 'done' where id = ${old}`;
  await make({ threadId: "recent", startsAt: new Date(NOW.getTime() + DAY) });
  const gone = await make({ threadId: "gone", startsAt: new Date(NOW.getTime() + 2 * DAY) });
  await sql`update content set status = 'cancelled' where id = ${gone}`;
  await make({ threadId: "x", startsAt: new Date(NOW.getTime() + DAY), guildId: "g2" });
  const s = await getStats(sql, "g1", NOW);
  assert.deepEqual([s.all.created, s.all.finished, s.all.cancelled], [3, 1, 1]);
  assert.deepEqual([s.month.created, s.month.finished, s.month.cancelled], [2, 0, 1]);
});

test("type and category counts leave out cancelled content", async () => {
  const sql = await testSql();
  await make({ threadId: "a", startsAt: new Date(NOW.getTime() + DAY), kind: "zvz" });
  await make({ threadId: "b", startsAt: new Date(NOW.getTime() + DAY), kind: "zvz" });
  await make({ threadId: "c", startsAt: new Date(NOW.getTime() + DAY), type: "pve", kind: "group-dungeon" });
  const d = await make({ threadId: "d", startsAt: new Date(NOW.getTime() + DAY), type: "pve", kind: "mists" });
  await sql`update content set status = 'cancelled' where id = ${d}`;
  const s = await getStats(sql, "g1", NOW);
  assert.deepEqual(s.byType, { pvp: 2, pve: 1, pvx: 0 });
  assert.deepEqual(s.byKind.map((k) => [k.type, k.kind, k.count]), [["pvp", "zvz", 2], ["pve", "group-dungeon", 1]]);
});

test("participants are distinct players on non-cancelled rosters; sign-ups count every roster entry; fills count too", async () => {
  const sql = await testSql();
  const a = await make({ threadId: "a", startsAt: new Date(NOW.getTime() + DAY) });
  const b = await make({ threadId: "b", startsAt: new Date(NOW.getTime() + DAY) });
  const c = await make({ threadId: "c", startsAt: new Date(NOW.getTime() + DAY) });
  await seat(a, 0, "p1"); await seat(a, 1, "p2");
  await seat(b, 0, "p1");
  await joinFill(sql, { contentId: b, userId: "p3", guildId: "g1", now: NOW });
  await seat(c, 0, "p9");
  await sql`update content set status = 'cancelled' where id = ${c}`;
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status, wait_role) values ('g1', ${a}, 'w1', null, 'waitlist', 'Tank')`;
  const s = await getStats(sql, "g1", NOW);
  assert.deepEqual([s.all.participants, s.all.signups], [3, 4], "p1, p2, p3; the waitlist and cancelled content do not count");
  assert.deepEqual(s.topPlayers, [{ userId: "p1", count: 2 }, { userId: "p2", count: 1 }, { userId: "p3", count: 1 }]);
});

test("the fill rate is the average of seated over positions for finished content", async () => {
  const sql = await testSql();
  const a = await make({ threadId: "a", startsAt: new Date(NOW.getTime() - DAY) });
  const b = await make({ threadId: "b", startsAt: new Date(NOW.getTime() - DAY) });
  await seat(a, 0, "p1"); await seat(a, 1, "p2"); // 2 of 2
  await seat(b, 0, "p3"); // 1 of 2
  await sql`update content set status = 'done'`;
  assert.equal((await getStats(sql, "g1", NOW)).fillRate, 75);
});

test("busiest day and hour (UTC) and the top hosts", async () => {
  const sql = await testSql();
  // 2026-10-15 is a Thursday (4); 2026-10-16 a Friday (5)
  await make({ threadId: "a", startsAt: new Date("2026-10-16T18:00:00Z") });
  await make({ threadId: "b", startsAt: new Date("2026-10-23T18:30:00Z"), createdBy: "other" });
  await make({ threadId: "c", startsAt: new Date("2026-10-15T20:00:00Z") });
  const s = await getStats(sql, "g1", NOW);
  assert.deepEqual(s.busiestDay, { day: 5, count: 2 });
  assert.deepEqual(s.busiestHour, { hour: 18, count: 2 });
  assert.deepEqual(s.topHosts, [{ userId: "boss", count: 2 }, { userId: "other", count: 1 }]);
});

test("the top lists are cut at 5 hosts and 10 players", async () => {
  const sql = await testSql();
  for (let n = 0; n < 7; n++) await make({ threadId: `h${n}`, startsAt: new Date(NOW.getTime() + DAY), createdBy: `host${n}` });
  const ids = await Promise.all([0, 1, 2].map((n) => make({ threadId: `p${n}`, startsAt: new Date(NOW.getTime() + DAY), slots: Array.from({ length: 5 }, () => ({ role: "DPS", weapon: "Bow" })) })));
  for (const id of ids) for (let n = 0; n < 4; n++) await seat(id, n, `player${n}`);
  for (let n = 4; n < 14; n++) await sql`insert into signup (guild_id, content_id, user_id, slot_id, status) values ('g1', ${ids[0]!}, ${"extra" + n}, null, 'fill')`;
  const s = await getStats(sql, "g1", NOW);
  assert.equal(s.topHosts.length, 5);
  assert.equal(s.topPlayers.length, 10);
});
