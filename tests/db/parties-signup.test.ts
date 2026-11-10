import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView } from "../../src/db/content.ts";
import { assignPlayer, claimSlot, getEntryParty, joinFill, joinWaitlist, leaveContent, type Promotion } from "../../src/db/signup.ts";

const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 40 * 60000);
const G = "g1";
const [A, B, C, OWNER] = ["100000000000000001", "100000000000000002", "100000000000000003", "100000000000000009"];
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

// Party 1: Tank, DPS (positions 1, 2). Party 2: Healer, Tank, DPS (positions 3, 4, 5) after sorting by role.
async function setup(over: { selection?: boolean } = {}) {
  const sql = await testSql();
  const id = await createContent(sql, {
    guildId: G, threadId: "t1", type: "pvp", title: "CTA", notes: null, startsAt: START, tier: "T8", hasLoot: false,
    createdBy: OWNER, now: NOW, cta: true, ...(over.selection ? { selection: true } : {}),
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "DPS", weapon: "Bow" }],
    slots2: [{ role: "Healer", weapon: "Holy" }, { role: "Tank", weapon: "Mace" }, { role: "DPS", weapon: "Bow" }],
  });
  const view = () => getRosterView(sql, id, NOW).then((v) => v!);
  const v = await view();
  const p1 = v.slots.filter((s) => s.party === 1).map((s) => s.id);
  const p2 = v.slots.filter((s) => s.party === 2).map((s) => s.id);
  return { sql, id, p1, p2, view };
}
const claim = (sql: any, id: string, slotId: string, userId: string, promoted?: Promotion[]) =>
  claimSlot(sql, { contentId: id, slotId, userId, guildId: G, now: NOW, ...(promoted ? { promoted } : {}) });
const partyOfUser = async (sql: any, id: string, u: string) => (await sql`select party from signup where content_id = ${id} and user_id = ${u}`)[0]?.party;

test("claiming a slot in the other party moves the player and frees the old seat", async () => {
  const { sql, id, p1, p2 } = await setup();
  assert.equal(await claim(sql, id, p1[0]!, A), "claimed");
  assert.equal(await partyOfUser(sql, id, A), 1);
  assert.equal(await claim(sql, id, p2[0]!, A), "moved");
  assert.equal(await partyOfUser(sql, id, A), 2);
  assert.equal((await sql`select count(*)::int n from signup where content_id = ${id}`)[0]!.n, 1);
  assert.equal(await claim(sql, id, p1[0]!, B), "claimed");
});

test("two players claiming the same slot: the second gets taken", async () => {
  const { sql, id, p2 } = await setup();
  assert.equal(await claim(sql, id, p2[0]!, A), "claimed");
  assert.equal(await claim(sql, id, p2[0]!, B), "taken");
});

test("a party 1 waitlist entry is not promoted by a party 2 slot, but is by a party 1 slot of its role", async () => {
  const { sql, id, p1, p2 } = await setup();
  const [p1tank, p1dps] = p1 as [string, string];
  await claim(sql, id, p1tank, A);
  await claim(sql, id, p2[1]!, B); // party 2 Tank
  assert.equal(await joinWaitlist(sql, { contentId: id, userId: C, guildId: G, role: "Tank", now: NOW, party: 1 }), "ok");
  assert.equal(await partyOfUser(sql, id, C), 1);
  const promoted: Promotion[] = [];
  await leaveContent(sql, { contentId: id, userId: B, guildId: G, now: NOW, promoted });
  assert.deepEqual(promoted, []);
  await leaveContent(sql, { contentId: id, userId: A, guildId: G, now: NOW, promoted });
  assert.deepEqual(promoted.map((p) => [p.userId, p.slotId]), [[C, p1tank]]);
  void p1dps;
});

test("waitlist: a role open in party 2 does not block party 1 from waiting, and vice versa", async () => {
  const { sql, id, p1 } = await setup();
  await claim(sql, id, p1[0]!, A); // party 1 tank full, party 2 tank open
  assert.equal(await joinWaitlist(sql, { contentId: id, userId: B, guildId: G, role: "Tank", now: NOW, party: 1 }), "ok");
  assert.equal(await joinWaitlist(sql, { contentId: id, userId: C, guildId: G, role: "Tank", now: NOW, party: 2 }), "open_slot");
});

test("a fill in party 2 takes the first suitable party 2 position, healers first, and waits when party 2 is full", async () => {
  const { sql, id, p2, view } = await setup();
  const r = await joinFill(sql, { contentId: id, userId: A, guildId: G, now: NOW, party: 2 });
  assert.equal(r.result, "seated");
  assert.equal(r.result === "seated" && r.slot.role, "Healer");
  assert.equal(await partyOfUser(sql, id, A), 2);
  await joinFill(sql, { contentId: id, userId: B, guildId: G, now: NOW, party: 2 });
  await joinFill(sql, { contentId: id, userId: C, guildId: G, now: NOW, party: 2 });
  assert.deepEqual((await joinFill(sql, { contentId: id, userId: OWNER, guildId: G, now: NOW, party: 2 })).result, "waiting");
  const v = await view();
  assert.deepEqual(v.fills, [OWNER]);
  assert.equal(v.slots.filter((s) => s.party === 1 && s.userId).length, 0, "party 1 stays empty");
  assert.equal(v.partyOf[OWNER], 2);
});

test("a party 2 fill is not seated by a party 1 slot freeing", async () => {
  const { sql, id, p1 } = await setup();
  await claim(sql, id, p1[0]!, A);
  await joinFill(sql, { contentId: id, userId: B, guildId: G, now: NOW, party: 2, pref: { any: false, roles: ["Nobody"], slotIds: [] } });
  const promoted: Promotion[] = [];
  await leaveContent(sql, { contentId: id, userId: A, guildId: G, now: NOW, promoted });
  assert.deepEqual(promoted, []);
});

test("host assignPlayer into party 2 sets party 2", async () => {
  const { sql, id, p2 } = await setup();
  await joinFill(sql, { contentId: id, userId: A, guildId: G, now: NOW, party: 1, pref: { any: false, roles: ["Nobody"], slotIds: [] } });
  assert.equal((await assignPlayer(sql, { contentId: id, guildId: G, userId: A, slotId: p2[0]!, now: NOW })).result, "ok");
  assert.equal(await partyOfUser(sql, id, A), 2);
});

test("applications record the party", async () => {
  const { sql, id, p2 } = await setup({ selection: true });
  assert.equal(await claim(sql, id, p2[0]!, A), "applied");
  assert.equal(await partyOfUser(sql, id, A), 2);
  const r = await joinFill(sql, { contentId: id, userId: B, guildId: G, now: NOW, party: 2 });
  assert.equal(r.result, "applied");
  assert.equal(await partyOfUser(sql, id, B), 2);
});

test("getEntryParty: the party of the entry, null for a stranger", async () => {
  const { sql, id, p2 } = await setup();
  await claim(sql, id, p2[0]!, A);
  assert.equal(await getEntryParty(sql, id, A), 2);
  assert.equal(await getEntryParty(sql, id, B), null);
});

test("party columns only accept 1 or 2", async () => {
  const { sql, id } = await setup();
  await assert.rejects(sql`update slot set party = 3 where content_id = ${id} and position = 1`);
  await assert.rejects(sql`insert into signup (guild_id, content_id, user_id, status, party) values ('g1', ${id}, 'x', 'fill', 0)`);
  await assert.rejects(sql`insert into content_message (guild_id, content_id, party, message_id) values ('g1', ${id}, 3, 'm')`);
});
