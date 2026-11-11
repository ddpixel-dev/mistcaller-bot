import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setPartyMessageId } from "../../src/db/content.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import { IS_COMPONENTS_V2, renderMovedNote, renderRosterMessage } from "../../src/render/roster.ts";
import { DiscordApiError, type Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { flatComponents } from "../helpers/discordLimits.ts";

const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 40 * 60000);
const G = "g1";
const [A, B] = ["100000000000000001", "100000000000000002"];
const edits: { messageId: string; body: any }[] = [];
const rest: Rest = {
  async createMessage() { return { id: "m" }; },
  async editMessage(_c: string, messageId: string, body: unknown) { edits.push({ messageId, body }); },
  async deleteMessage() {},
};
beforeEach(async () => { edits.length = 0; await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

// Party 1: Tank, DPS. Party 2: Healer, Tank, DPS.
async function setup(cta = true) {
  const sql = await testSql();
  const id = await createContent(sql, {
    guildId: G, threadId: "t1", type: "pvp", title: "CTA", notes: null, startsAt: START, tier: "T8", hasLoot: false,
    createdBy: "9", now: NOW, cta,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "DPS", weapon: "Bow" }],
    ...(cta ? { slots2: [{ role: "Healer", weapon: "Holy" }, { role: "Tank", weapon: "Mace" }, { role: "DPS", weapon: "Bow" }] } : {}),
  });
  await sql`update content set message_id = 'm1' where id = ${id}`;
  if (cta) await setPartyMessageId(sql, { guildId: G, contentId: id, party: 2, messageId: "m2" });
  const view = async () => (await getRosterView(sql, id, NOW))!;
  const v = await view();
  const deps: Deps = { sql, rest, now: () => NOW };
  return {
    sql, id, view, d: createDispatch(deps),
    p1: v.slots.filter((s) => s.party === 1).map((s) => s.id), p2: v.slots.filter((s) => s.party === 2).map((s) => s.id),
  };
}
const msg = { id: "m", flags: IS_COMPONENTS_V2 };
const base = (user: string): Interaction => ({ id: "i", type: 3, application_id: "a", token: "t", guild_id: G, message: msg, member: { user: { id: user }, roles: [] } });
const menu = (customId: string, values: unknown, user: string): Interaction => ({ ...base(user), data: { custom_id: customId, component_type: 3, values } });
const button = (customId: string, user: string): Interaction => ({ ...base(user), data: { custom_id: customId, component_type: 2 } });
const entry = async (sql: any, id: string, u: string) => (await sql`select party, status, slot_id from signup where content_id = ${id} and user_id = ${u}`)[0];
const text = (r: any) => JSON.stringify(r.data);

// The setup is a CTA posted with 0.31.8: m1 is party 1's message and m2 party 2's (a content_message row). ADR 0047:
// the CTA becomes one message, and m2 is turned into the moved note once.
const rows = async (sql: any, id: string) => (await sql`select party from content_message where content_id = ${id}`).map((r: any) => r.party);
const on = (i: Interaction, messageId: string): Interaction => ({ ...i, message: { id: messageId, flags: IS_COMPONENTS_V2 } });

test("a click on the roster answers with the whole CTA, and the old party 2 message becomes the note once", async () => {
  const { sql, id, p2, d, view } = await setup();
  const r: any = await d(on(menu(`join:${id}@2`, [p2[0]], A), "m1"));
  assert.equal(r.type, 7);
  assert.equal((await entry(sql, id, A)).party, 2);
  assert.deepEqual(r.data, renderRosterMessage(await view()), "the whole CTA");
  assert.ok(text(r).includes("**Party 1 (") && text(r).includes("**Party 2 ("), "both parties' headings");
  assert.deepEqual(edits, [{ messageId: "m2", body: renderMovedNote() }]);
  assert.deepEqual(await rows(sql, id), []);
  edits.length = 0;
  await d(on(button(`tent:${id}`, A), "m1"));
  assert.deepEqual(edits, [], "no other message is edited any more");
});

test("a click on the old party 2 message answers with the note and edits the roster above with the whole CTA", async () => {
  const { sql, id, p2, d, view } = await setup();
  const r: any = await d(on(menu(`join:${id}@2`, [p2[0]], A), "m2"));
  assert.equal(r.type, 7);
  assert.equal((await entry(sql, id, A)).party, 2, "the @2 of an old message still joins party 2");
  assert.deepEqual(r.data, renderMovedNote());
  assert.deepEqual(edits, [{ messageId: "m1", body: renderRosterMessage(await view()) }]);
  assert.deepEqual(await rows(sql, id), []);
});

test("picking a taken position gives the private taken reply", async () => {
  const { id, p2, d } = await setup();
  await d(menu(`join:${id}@2`, [p2[0]], A));
  const r: any = await d(menu(`join:${id}@2`, [p2[0]], B));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.ok(r.data.content.includes("just taken"));
});

test("Leave and Tentative act on the player's own place, whatever party the button names (shared buttons)", async () => {
  const { sql, id, p1, d } = await setup();
  await d(menu(`join:${id}`, [p1[0]], A));
  const t: any = await d(button(`tent:${id}@2`, A));
  assert.equal(t.type, 7, "an old party 2 Tentative button marks the party 1 player");
  assert.equal((await sql`select tentative from signup where content_id = ${id} and user_id = ${A}`)[0].tentative, true);
  const l: any = await d(button(`leave:${id}`, A));
  assert.equal(l.type, 7);
  assert.equal(await entry(sql, id, A), undefined);
});

test("Leave and Tentative on the player's own party 2 message work", async () => {
  const { sql, id, p2, d } = await setup();
  await d(menu(`join:${id}@2`, [p2[0]], A));
  const t: any = await d(button(`tent:${id}@2`, A));
  assert.equal(t.type, 7);
  const l: any = await d(button(`leave:${id}@2`, A));
  assert.equal(l.type, 7);
  assert.equal(await entry(sql, id, A), undefined);
});

test("Fill on party 2 waits in party 2 when no suitable party 2 position is open, and the panel carries the party", async () => {
  const { sql, id, p2, d } = await setup();
  const panel: any = await d(menu(`join:${id}@2`, ["fill"], A));
  assert.equal(panel.type, 4);
  assert.ok(flatComponents(panel.data).some((c: any) => c.custom_id === `fp:${id}@2`));
  for (const s of p2) await sql`insert into signup (guild_id, content_id, user_id, slot_id, status, party) values (${G}, ${id}, ${"2000" + s.slice(0, 4)}, ${s}, 'signed', 2)`;
  const r: any = await d(menu(`fp:${id}@2`, ["any"], A));
  assert.ok(r.data.content.includes("waiting as a fill"));
  const e = await entry(sql, id, A);
  assert.equal(e.status, "fill");
  assert.equal(e.party, 2);
});

test("a waitlist join on party 2 records party 2", async () => {
  const { sql, id, p2, d } = await setup();
  for (const s of p2) await sql`insert into signup (guild_id, content_id, user_id, slot_id, status, party) values (${G}, ${id}, ${"2000" + s.slice(0, 4)}, ${s}, 'signed', 2)`;
  const r: any = await d(menu(`wait:${id}@2`, ["Healer"], A));
  assert.equal(r.type, 7);
  const e = await entry(sql, id, A);
  assert.equal(e.status, "waitlist");
  assert.equal(e.party, 2);
});

test("a party 2 control on one-party content is refused and changes nothing", async () => {
  const { sql, id, p1, d } = await setup(false);
  for (const i of [menu(`join:${id}@2`, [p1[0]], A), menu(`wait:${id}@2`, ["Tank"], A), menu(`fp:${id}@2`, ["any"], A), button(`tent:${id}@2`, A), button(`leave:${id}@2`, A)]) {
    const r: any = await d(i);
    assert.equal(r.type, 4);
    assert.equal(r.data.content, "This control is not valid");
  }
  assert.equal(await entry(sql, id, A), undefined);
});

test("an old one-party roster button without a suffix works as before", async () => {
  const { sql, id, p1, d } = await setup(false);
  const r: any = await d(menu(`join:${id}`, [p1[0]], A));
  assert.equal(r.type, 7);
  assert.equal((await entry(sql, id, A)).party, 1);
  assert.deepEqual(edits, []);
});

test("a rate-limited edit of the other party's message does not delay or fail the reply", async () => {
  const { sql, id, p2, d } = await setup();
  const seen: unknown[] = [];
  const orig = rest.editMessage;
  rest.editMessage = async (_c, _m, _b, o) => { seen.push(o); throw new DiscordApiError(429, "rl"); };
  const logs: string[] = [];
  const log = console.error;
  console.error = (m: string) => { logs.push(String(m)); };
  try {
    const r: any = await d(menu(`join:${id}@2`, [p2[0]], A));
    assert.equal(r.type, 7);
    assert.equal((await entry(sql, id, A)).party, 2);
  } finally { rest.editMessage = orig; console.error = log; }
  assert.deepEqual(seen, [{ retry429: false }]);
  assert.equal(JSON.parse(logs[0]!).evt, "roster_edit_failed");
});

test("a new CTA (roster in the CTA channel, one message): the answer is the whole CTA and nothing else is edited", async () => {
  const sql = await testSql();
  const id = await createContent(sql, {
    guildId: G, threadId: "t9", rosterChannelId: "ch9", type: "pvp", title: "CTA", notes: null, startsAt: START, tier: "T8", hasLoot: false,
    createdBy: "9", now: NOW, cta: true, slots: [{ role: "Tank", weapon: "Mace" }], slots2: [{ role: "Healer", weapon: "Holy" }],
  });
  await sql`update content set message_id = 't9' where id = ${id}`;
  const d = createDispatch({ sql, rest, now: () => NOW });
  const v = (await getRosterView(sql, id, NOW))!;
  const p2 = v.slots.find((s) => s.party === 2)!.id;
  const r: any = await d({ ...on(menu(`join:${id}@2`, [p2], A), "t9"), channel: { id: "ch9", type: 0 } });
  assert.equal(r.type, 7);
  assert.deepEqual(r.data, renderRosterMessage((await getRosterView(sql, id, NOW))!));
  assert.deepEqual(edits, []);
});
