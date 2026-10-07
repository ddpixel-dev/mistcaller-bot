import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, type NewContent } from "../../src/db/content.ts";
import { claimSlot, leaveContent } from "../../src/db/signup.ts";
import { castVote } from "../../src/db/vote.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const base: NewContent = {
  guildId: "g1",
  threadId: "t1",
  type: "pvp",
  title: "Ganking",
  notes: null,
  startsAt: new Date("2026-12-01T18:00:00Z"),
  tier: { min: { tier: 8, enchant: 0 }, max: null },
  hasLoot: false,
  createdBy: "u1",
  slots: [
    { role: "Tank", weapon: "Mace" },
    { role: "Healer", weapon: "Holy" },
    { role: "DPS", weapon: "Bow" },
  ],
};

beforeEach(async () => {
  await resetDb(await testSql());
});
after(async () => {
  await (await testSql()).end();
});

let threadSeq = 0;
const freshThread = () => `thread-${++threadSeq}`;

async function setup(slots = base.slots) {
  const sql = await testSql();
  const contentId = await createContent(sql, { ...base, slots });
  const view = await getRosterView(sql, contentId, new Date());
  return { sql, contentId, slotIds: view!.slots.map((s) => s.id) };
}

async function holders(sql: Awaited<ReturnType<typeof testSql>>, contentId: string) {
  const v = await getRosterView(sql, contentId, new Date());
  return v!.slots.map((s) => s.userId);
}

test("claiming an open slot returns claimed and the roster shows the user", async () => {
  const { sql, contentId, slotIds } = await setup();
  const r = await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1", now: NOW });
  assert.equal(r, "claimed");
  assert.deepEqual(await holders(sql, contentId), ["u1", null, null]);
});

test("claiming a different slot returns moved and frees the old slot", async () => {
  const { sql, contentId, slotIds } = await setup();
  await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1", now: NOW });
  const r = await claimSlot(sql, { contentId, slotId: slotIds[1]!, userId: "u1", guildId: "g1", now: NOW });
  assert.equal(r, "moved");
  assert.deepEqual(await holders(sql, contentId), [null, "u1", null]);
});

test("claiming the same slot again returns unchanged", async () => {
  const { sql, contentId, slotIds } = await setup();
  const a = { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1", now: NOW };
  await claimSlot(sql, a);
  assert.equal(await claimSlot(sql, a), "unchanged");
  assert.deepEqual(await holders(sql, contentId), ["u1", null, null]);
  const rows = await sql`select 1 from signup where content_id = ${contentId}`;
  assert.equal(rows.length, 1);
});

test("another user claiming a taken slot returns taken and the holder is unchanged", async () => {
  const { sql, contentId, slotIds } = await setup();
  await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1", now: NOW });
  const r = await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u2", guildId: "g1", now: NOW });
  assert.equal(r, "taken");
  assert.deepEqual(await holders(sql, contentId), ["u1", null, null]);
  const rows = await sql`select 1 from signup where content_id = ${contentId} and user_id = 'u2'`;
  assert.equal(rows.length, 0);
});

test("moving onto a taken slot returns taken and keeps the old slot", async () => {
  const { sql, contentId, slotIds } = await setup();
  await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1", now: NOW });
  await claimSlot(sql, { contentId, slotId: slotIds[1]!, userId: "u2", guildId: "g1", now: NOW });
  const r = await claimSlot(sql, { contentId, slotId: slotIds[1]!, userId: "u1", guildId: "g1", now: NOW });
  assert.equal(r, "taken");
  assert.deepEqual(await holders(sql, contentId), ["u1", "u2", null]);
});

test("a slot of another content or a different guild returns not_found", async () => {
  const { sql, contentId, slotIds } = await setup();
  const other = await createContent(sql, { ...base, threadId: "t2" });
  const otherSlots = (await getRosterView(sql, other, new Date()))!.slots;
  assert.equal(
    await claimSlot(sql, { contentId, slotId: otherSlots[0]!.id, userId: "u1", guildId: "g1", now: NOW }),
    "not_found",
  );
  assert.equal(
    await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g2", now: NOW }),
    "not_found",
  );
  assert.equal(
    await claimSlot(sql, {
      contentId: "00000000-0000-0000-0000-000000000000",
      slotId: slotIds[0]!,
      userId: "u1",
      guildId: "g1",
      now: NOW,
    }),
    "not_found",
  );
  assert.deepEqual(await holders(sql, contentId), [null, null, null]);
});

test("locked, cancelled and done content return locked for a claim", async () => {
  const { sql, contentId, slotIds } = await setup();
  for (const status of ["locked", "cancelled", "done"]) {
    await sql`update content set status = ${status} where id = ${contentId}`;
    const r = await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1", now: NOW });
    assert.equal(r, "locked", status);
  }
  assert.deepEqual(await holders(sql, contentId), [null, null, null]);
});

test("race: two different users on one slot yield exactly one claimed and one taken", async () => {
  const sql = await testSql();
  for (let i = 0; i < 25; i++) {
    const contentId = await createContent(sql, { ...base, slots: [{ role: "Tank", weapon: "Mace" }], threadId: freshThread() });
    const slotId = (await getRosterView(sql, contentId, new Date()))!.slots[0]!.id;
    const results = await Promise.all([
      claimSlot(sql, { contentId, slotId, userId: "ua", guildId: "g1", now: NOW }),
      claimSlot(sql, { contentId, slotId, userId: "ub", guildId: "g1", now: NOW }),
    ]);
    assert.deepEqual([...results].sort(), ["claimed", "taken"], `trial ${i}`);
  }
});

test("leaveContent frees the slot, then returns not_signed", async () => {
  const { sql, contentId, slotIds } = await setup();
  await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1", now: NOW });
  assert.equal(await leaveContent(sql, { contentId, userId: "u1" }), "left");
  assert.deepEqual(await holders(sql, contentId), [null, null, null]);
  assert.equal(await leaveContent(sql, { contentId, userId: "u1" }), "not_signed");
  assert.equal(await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u2", guildId: "g1", now: NOW }), "claimed");
});

test("leaveContent works on locked content and is unavailable on cancelled or done", async () => {
  const { sql, contentId, slotIds } = await setup();
  await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1", now: NOW });
  await sql`update content set status = 'locked' where id = ${contentId}`;
  assert.equal(await leaveContent(sql, { contentId, userId: "u1" }), "left");

  await sql`update content set status = 'open' where id = ${contentId}`;
  await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1", now: NOW });
  for (const status of ["cancelled", "done"]) {
    await sql`update content set status = ${status} where id = ${contentId}`;
    assert.equal(await leaveContent(sql, { contentId, userId: "u1" }), "unavailable", status);
  }
  assert.deepEqual(await holders(sql, contentId), ["u1", null, null]);
  assert.equal(
    await leaveContent(sql, { contentId: "00000000-0000-0000-0000-000000000000", userId: "u1" }),
    "unavailable",
  );
});

const VALID = ["claimed", "moved", "unchanged", "taken"];

type TestSql = Awaited<ReturnType<typeof testSql>>;

function failingBegin(sql: TestSql, codes: (string | null)[]) {
  const counter = { calls: 0 };
  const proxy = new Proxy(sql, {
    get(target, prop, receiver) {
      if (prop === "begin") {
        return (...args: unknown[]) => {
          const code = codes[Math.min(counter.calls, codes.length - 1)];
          counter.calls++;
          if (code) return Promise.reject(Object.assign(new Error("x"), { code }));
          return (target.begin as (...a: unknown[]) => unknown)(...args);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as TestSql;
  return { proxy, counter };
}

for (const code of ["40P01", "40001"]) {
  test(`claimSlot retries once after a first ${code} failure`, async () => {
    const { sql, contentId, slotIds } = await setup();
    const { proxy, counter } = failingBegin(sql, [code, null]);
    const r = await claimSlot(proxy, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1", now: NOW });
    assert.equal(r, "claimed");
    assert.equal(counter.calls, 2);
    assert.deepEqual(await holders(sql, contentId), ["u1", null, null]);
  });
}

test("claimSlot returns taken when the retry also deadlocks, with no further retry", async () => {
  const { sql, contentId, slotIds } = await setup();
  const { proxy, counter } = failingBegin(sql, ["40P01"]);
  const r = await claimSlot(proxy, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1", now: NOW });
  assert.equal(r, "taken");
  assert.equal(counter.calls, 2);
  const rows = await sql`select 1 from signup where content_id = ${contentId}`;
  assert.equal(rows.length, 0);
});

test("claimSlot rethrows unexpected errors without retrying", async () => {
  const { sql, contentId, slotIds } = await setup();
  const { proxy, counter } = failingBegin(sql, ["XX000"]);
  await assert.rejects(claimSlot(proxy, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1", now: NOW }));
  assert.equal(counter.calls, 1);
});

// Probabilistic stress test: it may never hit a real deadlock. The deterministic
// tests above are what pin the retry behavior.
test("swap: two users swapping slots concurrently never throw or double-book", async () => {
  const sql = await testSql();
  for (let i = 0; i < 10; i++) {
    const contentId = await createContent(sql, { ...base, slots: base.slots.slice(0, 2), threadId: freshThread() });
    const [s1, s2] = (await getRosterView(sql, contentId, new Date()))!.slots.map((s) => s.id) as [string, string];
    await claimSlot(sql, { contentId, slotId: s1, userId: "ua", guildId: "g1", now: NOW });
    await claimSlot(sql, { contentId, slotId: s2, userId: "ub", guildId: "g1", now: NOW });
    const results = await Promise.all([
      claimSlot(sql, { contentId, slotId: s2, userId: "ua", guildId: "g1", now: NOW }),
      claimSlot(sql, { contentId, slotId: s1, userId: "ub", guildId: "g1", now: NOW }),
    ]);
    for (const r of results) assert.ok(VALID.includes(r), `trial ${i}: ${r}`);
    const bySlot = await sql`
      select slot_id, count(*)::int as n from signup
      where content_id = ${contentId} and status = 'signed' group by slot_id`;
    for (const r of bySlot) assert.equal(r.n, 1, `trial ${i}`);
    const byUser = await sql`
      select user_id, count(*)::int as n from signup where content_id = ${contentId} group by user_id`;
    for (const r of byUser) assert.equal(r.n, 1, `trial ${i}`);
  }
});

test("concurrent double delivery by the same new user leaves one signup row", async () => {
  const sql = await testSql();
  for (let i = 0; i < 10; i++) {
    const contentId = await createContent(sql, { ...base, slots: base.slots.slice(0, 1), threadId: freshThread() });
    const slotId = (await getRosterView(sql, contentId, new Date()))!.slots[0]!.id;
    const a = { contentId, slotId, userId: "ua", guildId: "g1", now: NOW };
    const results = await Promise.all([claimSlot(sql, a), claimSlot(sql, a)]);
    for (const r of results) assert.ok(VALID.includes(r), `trial ${i}: ${r}`);
    const rows = await sql`select slot_id, status from signup where content_id = ${contentId} and user_id = 'ua'`;
    assert.equal(rows.length, 1, `trial ${i}`);
    assert.equal(rows[0]!.slot_id, slotId);
    assert.equal(rows[0]!.status, "signed");
  }
});

test("a claim waiting on a content lock sees the committed lock and returns locked", async () => {
  const { sql, contentId, slotIds } = await setup();
  let claim!: Promise<string>;
  await sql.begin(async (tx) => {
    await tx`select 1 from content where id = ${contentId} for update`;
    claim = claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1", now: NOW });
    await new Promise((r) => setTimeout(r, 300));
    await tx`update content set status = 'locked' where id = ${contentId}`;
  });
  assert.equal(await claim, "locked");
  const rows = await sql`select 1 from signup where content_id = ${contentId}`;
  assert.equal(rows.length, 0);
});

test("claim at exactly starts_at is locked with no row written; one millisecond before is accepted", async () => {
  const { sql, contentId, slotIds } = await setup();
  const startsAt = base.startsAt;
  const at = await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1", now: startsAt });
  assert.equal(at, "locked");
  assert.equal((await sql`select 1 from signup where content_id = ${contentId}`).length, 0);
  const after = await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1", now: new Date(startsAt.getTime() + 1) });
  assert.equal(after, "locked");
  const before = await claimSlot(sql, { contentId, slotId: slotIds[0]!, userId: "u1", guildId: "g1", now: new Date(startsAt.getTime() - 1) });
  assert.equal(before, "claimed");
});

async function lootSetup() {
  const sql = await testSql();
  const contentId = await createContent(sql, { ...base, hasLoot: true });
  const slotIds = (await getRosterView(sql, contentId, NOW))!.slots.map((s) => s.id);
  const sign = async (userId: string, n: number) =>
    assert.equal(await claimSlot(sql, { contentId, slotId: slotIds[n]!, userId, guildId: "g1", now: NOW }), "claimed");
  const vote = (userId: string) =>
    castVote(sql, { contentId, userId, guildId: "g1", choice: "split", now: NOW });
  const votes = async () => (await getRosterView(sql, contentId, NOW))!.votes.split;
  return { sql, contentId, sign, vote, votes };
}

test("leaving removes the member's vote and the count drops", async () => {
  const { sql, contentId, sign, vote, votes } = await lootSetup();
  await sign("u1", 0);
  await sign("u2", 1);
  assert.equal(await vote("u1"), "recorded");
  assert.equal(await vote("u2"), "recorded");
  assert.equal(await votes(), 2);
  assert.equal(await leaveContent(sql, { contentId, userId: "u1" }), "left");
  assert.equal(await votes(), 1);
  assert.equal((await sql`select 1 from vote where content_id = ${contentId} and user_id = 'u1'`).length, 0);
});

test("leaving without a vote still returns left; re-sign-up then vote counts once", async () => {
  const { sql, contentId, sign, vote, votes } = await lootSetup();
  await sign("u1", 0);
  assert.equal(await leaveContent(sql, { contentId, userId: "u1" }), "left");
  await sign("u1", 0);
  assert.equal(await vote("u1"), "recorded");
  assert.equal(await votes(), 1);
  assert.equal(await leaveContent(sql, { contentId, userId: "u1" }), "left");
  await sign("u1", 0);
  assert.equal(await vote("u1"), "recorded");
  assert.equal(await votes(), 1);
});

test("leaving locked content also removes the vote", async () => {
  const { sql, contentId, sign, vote, votes } = await lootSetup();
  await sign("u1", 0);
  await vote("u1");
  await sql`update content set status = 'locked' where id = ${contentId}`;
  assert.equal(await leaveContent(sql, { contentId, userId: "u1" }), "left");
  assert.equal(await votes(), 0);
});

test("a not_signed leave leaves other members' votes untouched", async () => {
  const { sql, contentId, sign, vote, votes } = await lootSetup();
  await sign("u1", 0);
  await vote("u1");
  assert.equal(await leaveContent(sql, { contentId, userId: "stranger" }), "not_signed");
  assert.equal(await votes(), 1);
});
