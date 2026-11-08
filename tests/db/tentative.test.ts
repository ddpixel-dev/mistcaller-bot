import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView } from "../../src/db/content.ts";
import { assignPlayer, claimSlot, joinFill, joinWaitlist, leaveContent, setTentative } from "../../src/db/signup.ts";
import { cancelContent, lockContent } from "../../src/db/manage.ts";

// FR-067: the tentative flag is on the sign-up row, so it follows the player between seat, fill, applicants and waitlist.
const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 60 * 60000);
const G = "g1";
const [A, B, C, OWNER] = ["100000000000000001", "100000000000000002", "100000000000000003", "100000000000000009"];
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup(selection = false, thread = "t1") {
  const sql = await testSql();
  const id = await createContent(sql, {
    guildId: G, threadId: thread, type: "pvp", title: "Roam", notes: null, startsAt: START, tier: "T8", hasLoot: false, createdBy: OWNER, now: NOW, selection,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }],
  });
  const view = () => getRosterView(sql, id, NOW).then((v) => v!);
  return { sql, id, slots: (await view()).slots.map((s) => s.id), view };
}
const claim = (sql: any, id: string, slotId: string, userId: string) => claimSlot(sql, { contentId: id, slotId, userId, guildId: G, now: NOW });
const set = (sql: any, id: string, userId: string, value?: boolean) => setTentative(sql, { contentId: id, guildId: G, userId, ...(value === undefined ? {} : { value }) });

test("a seated player toggles tentative on and off; the roster lists them", async () => {
  const { sql, id, slots, view } = await setup();
  await claim(sql, id, slots[0]!, A);
  assert.deepEqual(await view().then((v) => v.tentative ?? []), []);
  assert.deepEqual(await set(sql, id, A), { result: "ok", tentative: true });
  assert.deepEqual((await view()).tentative, [A]);
  assert.deepEqual(await set(sql, id, A), { result: "ok", tentative: false });
  assert.deepEqual((await view()).tentative ?? [], []);
  assert.deepEqual(await set(sql, id, A, true), { result: "ok", tentative: true }, "an explicit value is set, not flipped");
  assert.deepEqual(await set(sql, id, A, true), { result: "ok", tentative: true });
});

test("a player who is not signed up, a stranger's guild, finished or missing content are refused", async () => {
  const { sql, id, slots } = await setup();
  assert.deepEqual(await set(sql, id, A), { result: "not_signed" });
  await claim(sql, id, slots[0]!, A);
  assert.deepEqual(await setTentative(sql, { contentId: id, guildId: "other", userId: A }), { result: "not_found" });
  assert.deepEqual(await setTentative(sql, { contentId: "00000000-0000-0000-0000-000000000000", guildId: G, userId: A }), { result: "not_found" });
  await cancelContent(sql, id);
  assert.deepEqual(await set(sql, id, A), { result: "unavailable" });
});

test("it still works while sign-ups are locked", async () => {
  const { sql, id, slots } = await setup();
  await claim(sql, id, slots[0]!, A);
  await lockContent(sql, id);
  assert.deepEqual(await set(sql, id, A), { result: "ok", tentative: true });
});

test("the flag follows the player: a move, a host move, a fill seated at once, a waitlist promotion", async () => {
  const { sql, id, slots, view } = await setup();
  await claim(sql, id, slots[0]!, A);
  await set(sql, id, A);
  await claim(sql, id, slots[1]!, A); // moves themselves
  assert.deepEqual((await view()).tentative, [A]);
  await leaveContent(sql, { contentId: id, userId: A, guildId: G });
  assert.deepEqual((await view()).tentative ?? [], [], "leaving ends it");
  await claim(sql, id, slots[1]!, A);
  assert.deepEqual((await view()).tentative ?? [], [], "signing up again starts confirmed");

  // Waitlisted while the Healer seat is full, then promoted when it frees up.
  assert.equal(await joinWaitlist(sql, { contentId: id, userId: B, guildId: G, role: "Healer", now: NOW }), "ok");
  await set(sql, id, B);
  const promoted: any[] = [];
  await leaveContent(sql, { contentId: id, userId: A, guildId: G, now: NOW, promoted });
  const v = await view();
  assert.equal(v.slots[1]!.userId, B, "B was promoted into the seat");
  assert.deepEqual(v.tentative, [B]);

  // A host move keeps it too.
  assert.equal((await assignPlayer(sql, { contentId: id, guildId: G, userId: B, slotId: slots[0]!, now: NOW })).result, "ok");
  assert.deepEqual((await view()).tentative, [B]);
});

test("a fill and an applicant can be tentative, and keep it when seated or accepted", async () => {
  const f = await setup(false, "t1");
  await joinFill(f.sql, { contentId: f.id, userId: C, guildId: G, now: NOW, pref: { any: false, roles: ["Scout"], slotIds: [] } });
  assert.deepEqual((await f.view()).fills, [C], "C waits as a fill: no Scout position exists");
  assert.deepEqual(await set(f.sql, f.id, C), { result: "ok", tentative: true });
  assert.deepEqual((await f.view()).tentative, [C]);

  const s = await setup(true, "t2");
  assert.equal(await claim(s.sql, s.id, s.slots[0]!, A), "applied");
  assert.deepEqual(await set(s.sql, s.id, A), { result: "ok", tentative: true });
  assert.deepEqual((await s.view()).tentative, [A]);
  assert.equal((await assignPlayer(s.sql, { contentId: s.id, guildId: G, userId: A, slotId: s.slots[0]!, now: NOW })).result, "ok");
  const v = await s.view();
  assert.equal(v.slots[0]!.userId, A);
  assert.deepEqual(v.tentative, [A], "the accepted applicant is still tentative");
});

test("tentative players still hold their seat and count in the party", async () => {
  const { sql, id, slots, view } = await setup();
  await claim(sql, id, slots[0]!, A);
  await set(sql, id, A);
  assert.equal((await view()).slots[0]!.userId, A);
  assert.equal(await claim(sql, id, slots[0]!, B), "taken");
});
