import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setMessageId } from "../../src/db/content.ts";
import { refreshRosters } from "../../src/handlers/rosters.ts";
import { renderMovedNote, renderRosterMessage } from "../../src/render/roster.ts";
import { DiscordApiError, type Rest } from "../../src/discord/rest.ts";
import type { Deps } from "../../src/discord/dispatch.ts";

const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 40 * 60000);
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup(failOn: string[] = [], over: Record<string, unknown> = {}) {
  const sql = await testSql();
  const id = await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvp", title: "Raid", notes: null, startsAt: START,
    tier: "T8.0", hasLoot: false, createdBy: "100000000000000001", now: NOW,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }], ...over,
  });
  const edits: { channel: string; message: string; body: unknown }[] = [];
  const rest: Rest = {
    async createMessage() { return { id: "x" }; },
    async editMessage(channel, message, body) {
      edits.push({ channel, message, body });
      if (failOn.includes(message)) throw new DiscordApiError(500, "boom message text");
      if (failOn.includes(`404:${message}`)) throw new DiscordApiError(404, "gone");
    },
    async deleteMessage() {},
    async createDm() { return "dm"; },
  };
  const deps: Deps = { sql, rest, now: () => NOW };
  const view = async () => (await getRosterView(sql, id, NOW))!;
  return { sql, id, deps, edits, view };
}
const addParty2 = (sql: Awaited<ReturnType<typeof testSql>>, id: string) =>
  sql`insert into content_message (guild_id, content_id, party, message_id) values ('g1', ${id}, 2, 'm2')`;

test("one party: exactly one edit, to the view's message", async () => {
  const { sql, id, deps, edits, view } = await setup();
  await setMessageId(sql, id, "m1");
  const v = await view();
  await refreshRosters(deps, v);
  assert.equal(edits.length, 1);
  assert.deepEqual(edits[0], { channel: "t1", message: "m1", body: renderRosterMessage(v, 1) });
});

test("two parties: one edit per message", async () => {
  const { sql, id, deps, edits, view } = await setup();
  await setMessageId(sql, id, "m1");
  await addParty2(sql, id);
  await refreshRosters(deps, await view());
  assert.deepEqual(edits.map((e) => e.message), ["m1", "m2"]);
});

test("each message gets its own party's rendering", async () => {
  const { sql, id, deps, edits, view } = await setup();
  await setMessageId(sql, id, "m1");
  await addParty2(sql, id);
  const v = await view();
  await refreshRosters(deps, v);
  assert.deepEqual(edits.map((e) => e.body), [renderRosterMessage(v, 1), renderRosterMessage(v, 2)]);
  assert.notDeepEqual(edits[0]!.body, edits[1]!.body);
});

test("except skips that party", async () => {
  const { sql, id, deps, edits, view } = await setup();
  await setMessageId(sql, id, "m1");
  await addParty2(sql, id);
  await refreshRosters(deps, await view(), { except: 1 });
  assert.deepEqual(edits.map((e) => e.message), ["m2"]);
});

test("a failing edit is logged without text and does not stop the others", async () => {
  const { sql, id, deps, edits, view } = await setup(["m1"]);
  await setMessageId(sql, id, "m1");
  await addParty2(sql, id);
  const logs: string[] = [];
  const orig = console.error;
  console.error = (m: string) => { logs.push(String(m)); };
  try { await refreshRosters(deps, await view()); } finally { console.error = orig; }
  assert.deepEqual(edits.map((e) => e.message), ["m1", "m2"]);
  const log = JSON.parse(logs[0]!);
  assert.equal(log.evt, "roster_edit_failed");
  assert.equal(log.status, 500);
  assert.ok(!logs[0]!.includes("boom message text"));
});

test("no message at all makes no call", async () => {
  const { deps, edits, view } = await setup();
  await refreshRosters(deps, await view());
  assert.equal(edits.length, 0);
});

test("strict rethrows a non-404 failure after trying every party, but not a 404", async () => {
  const { sql, id, deps, edits, view } = await setup(["m1"]);
  await setMessageId(sql, id, "m1");
  await addParty2(sql, id);
  const orig = console.error;
  console.error = () => {};
  try {
    await assert.rejects(refreshRosters(deps, await view(), { strict: true }), DiscordApiError);
    assert.deepEqual(edits.map((e) => e.message), ["m1", "m2"]);
    const gone: Deps = { ...deps, rest: { ...deps.rest, async editMessage() { throw new DiscordApiError(404, "gone"); } } };
    await refreshRosters(gone, await view(), { strict: true });
  } finally { console.error = orig; }
});

test("noRetry passes retry429 false to the edit; the default does not", async () => {
  const sql = await testSql();
  const { id, deps, view } = await setup();
  void sql;
  await setMessageId(await testSql(), id, "m1");
  const seen: unknown[] = [];
  const rest = { ...deps.rest, async editMessage(_c: string, _m: string, _b: unknown, o?: unknown) { seen.push(o); } } as Rest;
  await refreshRosters({ ...deps, rest }, await view(), { noRetry: true });
  await refreshRosters({ ...deps, rest }, await view());
  assert.deepEqual(seen, [{ retry429: false }, undefined]);
});

test("the failure log carries the content id and no text", async () => {
  const { sql, id, deps, view } = await setup(["m1"]);
  await setMessageId(sql, id, "m1");
  const logs: string[] = [];
  const orig = console.error;
  console.error = (m: string) => { logs.push(String(m)); };
  try { await refreshRosters(deps, await view()); } finally { console.error = orig; }
  assert.equal(JSON.parse(logs[0]!).contentId, id);
});

// ADR 0047: a call to arms is one message, in the CTA channel when it has one.
const CTA = { cta: true, slots2: [{ role: "DPS", weapon: "Bow" }] };
const rows = async (sql: Awaited<ReturnType<typeof testSql>>, id: string) =>
  (await sql`select party from content_message where content_id = ${id}`).map((r) => r.party);

test("a CTA with a roster channel is edited there, as one message", async () => {
  const { sql, id, deps, edits, view } = await setup([], { ...CTA, rosterChannelId: "ch9" });
  await setMessageId(sql, id, "t1");
  const v = await view();
  await refreshRosters(deps, v);
  assert.deepEqual(edits, [{ channel: "ch9", message: "t1", body: renderRosterMessage(v) }]);
});

test("a 0.31.8 CTA: party 1's message gets the whole CTA, party 2's is turned into the note once and forgotten", async () => {
  const { sql, id, deps, edits, view } = await setup([], CTA);
  await setMessageId(sql, id, "m1");
  await addParty2(sql, id);
  const v = await view();
  await refreshRosters(deps, v);
  assert.deepEqual(edits, [
    { channel: "t1", message: "m1", body: renderRosterMessage(v) },
    { channel: "t1", message: "m2", body: renderMovedNote() },
  ]);
  assert.deepEqual(await rows(sql, id), [], "the party 2 row is deleted");
  edits.length = 0;
  await refreshRosters(deps, await view());
  assert.deepEqual(edits.map((e) => e.message), ["m1"], "the note is not edited again");
});

test("a 0.31.8 CTA: a deleted party 2 message (404) is forgotten too; another failure keeps the row for the next refresh", async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    const a = await setup(["404:m2"], CTA);
    await setMessageId(a.sql, a.id, "m1");
    await addParty2(a.sql, a.id);
    await refreshRosters(a.deps, await a.view(), { strict: true });
    assert.deepEqual(await rows(a.sql, a.id), []);
    await resetDb(a.sql);
    const b = await setup(["m2"], CTA);
    await setMessageId(b.sql, b.id, "m1");
    await addParty2(b.sql, b.id);
    await refreshRosters(b.deps, await b.view());
    assert.deepEqual(await rows(b.sql, b.id), [2]);
  } finally { console.error = orig; }
});

test("a 0.31.8 CTA: except 2 (the caller answers the party 2 message with the note) edits party 1 and forgets party 2", async () => {
  const { sql, id, deps, edits, view } = await setup([], CTA);
  await setMessageId(sql, id, "m1");
  await addParty2(sql, id);
  await refreshRosters(deps, await view(), { except: 2 });
  assert.deepEqual(edits.map((e) => e.message), ["m1"]);
  assert.deepEqual(await rows(sql, id), []);
});

test("a 0.31.8 CTA: except 1 converts party 2 only", async () => {
  const { sql, id, deps, edits, view } = await setup([], CTA);
  await setMessageId(sql, id, "m1");
  await addParty2(sql, id);
  await refreshRosters(deps, await view(), { except: 1 });
  assert.deepEqual(edits, [{ channel: "t1", message: "m2", body: renderMovedNote() }]);
  assert.deepEqual(await rows(sql, id), []);
});
