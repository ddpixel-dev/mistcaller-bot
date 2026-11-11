import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setPartyMessageId } from "../../src/db/content.ts";
import { claimSlot, joinFill, joinWaitlist } from "../../src/db/signup.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import { partyChoice } from "../../src/handlers/party-pick.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { WAITING } from "../helpers/fills.ts";

const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 40 * 60000);
const G = "g1";
const OWNER = "100000000000000009";
const [A, B, C] = ["100000000000000001", "100000000000000002", "100000000000000003"];
const edits: { messageId: string; body: any }[] = [];
const posts: any[] = [];
const rest: Rest = {
  async createMessage(_c, body) { posts.push(body); return { id: "m" }; },
  async editMessage(_c: string, messageId: string, body: unknown) { edits.push({ messageId, body }); },
  async deleteMessage() {},
  async memberName(_g, u) { return `Name-${u.slice(-1)}`; },
};
beforeEach(async () => { edits.length = 0; posts.length = 0; await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

// Party 1: Tank (no weapon), DPS. Party 2: Tank (no weapon), Healer, DPS (createContent orders by role).
async function setup(cta = true, selection = false, thread = "t1") {
  const sql = await testSql();
  const id = await createContent(sql, {
    guildId: G, threadId: thread, type: "pvp", title: "CTA", notes: null, startsAt: START, tier: "T8", hasLoot: false,
    createdBy: OWNER, now: NOW, cta,
    slots: [{ role: "Tank", weapon: "" }, { role: "DPS", weapon: "Bow" }],
    ...(cta ? { slots2: [{ role: "Healer", weapon: "Holy" }, { role: "Tank", weapon: "" }, { role: "DPS", weapon: "Bow" }] } : {}),
  });
  await sql`update content set message_id = 'm1', selection = ${selection} where id = ${id}`;
  if (cta) await setPartyMessageId(sql, { guildId: G, contentId: id, party: 2, messageId: "m2" });
  const v = (await getRosterView(sql, id, NOW))!;
  const deps: Deps = { sql, rest, now: () => NOW };
  return {
    sql, id, view: async () => (await getRosterView(sql, id, NOW))!, d: createDispatch(deps),
    p1: v.slots.filter((s) => s.party === 1), p2: v.slots.filter((s) => s.party === 2),
  };
}
const base = (user: string): Interaction => ({ id: "i", type: 3, application_id: "a", token: "t", guild_id: G, channel: { id: "t1", type: 11 }, message: { id: "p", flags: 64 }, member: { user: { id: user }, roles: [] } });
const menu = (customId: string, values: unknown, user = OWNER): Interaction => ({ ...base(user), data: { custom_id: customId, component_type: 3, values } });
const button = (customId: string, user = OWNER): Interaction => ({ ...base(user), data: { custom_id: customId, component_type: 2 } });
const ids = (r: any) => r.data.components.flatMap((row: any) => row.components.map((c: any) => c.custom_id));
const opts = (r: any, i = 0) => r.data.components[i].components[0].options;
const choice = (r: any) => r.data.components[0].components.map((c: any) => [c.label, c.custom_id]);

test("partyChoice returns two Party buttons, or null with one party", async () => {
  const { id, view } = await setup();
  const row: any = partyChoice("fa:g", id, await view());
  assert.deepEqual(row.components.map((c: any) => [c.label, c.custom_id]), [["Party 1", `fa:g:${id}`], ["Party 2", `fa:g:${id}@2`]]);
  const one = await setup(false, false, "t2");
  assert.equal(partyChoice("fa:g", one.id, await one.view()), null);
});

test("Assign player asks for the party, then lists that party's fills and only its open positions; seating goes to that party", async () => {
  const { d, id, sql, p2 } = await setup();
  await joinFill(sql, { contentId: id, userId: A, guildId: G, now: NOW, pref: WAITING, party: 2 });
  await joinFill(sql, { contentId: id, userId: B, guildId: G, now: NOW, pref: WAITING, party: 1 });
  const r1: any = await d(button(`fa:${id}`));
  assert.equal(r1.type, 4);
  assert.deepEqual(choice(r1), [["Party 1", `fa:g:${id}`], ["Party 2", `fa:g:${id}@2`]]);
  const r2: any = await d(button(`fa:g:${id}@2`));
  assert.equal(r2.type, 7);
  assert.deepEqual(opts(r2).map((o: any) => o.value), [A], "only the party 2 fill");
  assert.equal(r2.data.components[0].components[0].custom_id, `fa:p:${id}@2`);
  assert.equal(r2.data.components[1].components[0].custom_id, `fa:u:${id}@2`);
  const r3: any = await d(menu(`fa:u:${id}@2`, [C]));
  const positions = opts(r3, 2);
  assert.deepEqual(positions.map((o: any) => o.value), p2.map((s) => s.id));
  assert.deepEqual(positions.map((o: any) => o.label.split(".")[0]), ["1", "2", "3"], "numbered from 1 in party 2");
  assert.equal(r3.data.components[2].components[0].custom_id, `fa:s:${id}:${C}@2`);
  const r4: any = await d(menu(`fa:s:${id}:${C}@2`, [p2[1]!.id]));
  assert.equal(r4.type, 7, JSON.stringify(r4.data));
  const [row] = await sql`select party, slot_id from signup where content_id = ${id} and user_id = ${C}`;
  assert.equal(row!.party, 2);
  assert.equal(row!.slot_id, p2[1]!.id);
  assert.deepEqual(edits.map((e) => e.messageId).sort(), ["m1", "m2"], "every party message refreshed");
});

test("Assign player with one party skips the choice", async () => {
  const { d, id } = await setup(false);
  const r: any = await d(button(`fa:${id}`));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.ok(ids(r).every((c: string) => !c.includes("@") && !c.startsWith("fa:g")));
});

test("Review applicants lists only the chosen party's applicants", async () => {
  const { d, id, sql } = await setup(true, true);
  await joinFill(sql, { contentId: id, userId: A, guildId: G, now: NOW, pref: WAITING, party: 2 });
  await joinFill(sql, { contentId: id, userId: B, guildId: G, now: NOW, pref: WAITING, party: 1 });
  const r1: any = await d(button(`fa:r:${id}`));
  assert.deepEqual(choice(r1), [["Party 1", `fa:rg:${id}`], ["Party 2", `fa:rg:${id}@2`]]);
  const r2: any = await d(button(`fa:rg:${id}@2`));
  assert.deepEqual(opts(r2).map((o: any) => o.value), [A]);
  assert.equal(r2.data.components[0].components[0].custom_id, `fa:q:${id}@2`);
  const r3: any = await d(button(`fa:rg:${id}`));
  assert.deepEqual(opts(r3).map((o: any) => o.value), [B]);
});

test("a party above the number of parties is refused", async () => {
  const one = await setup(false);
  for (const c of [`fa:g:${one.id}@2`, `rm:g:${one.id}@2`, `dt:g:${one.id}@2`, `sw:g:${one.id}@2`]) {
    const r: any = await one.d(button(c));
    assert.ok(String(r.data.content).includes("not valid"), c);
  }
  const bad: any = await one.d(button(`fa:g:${one.id}@3`));
  assert.ok(String(bad.data.content).includes("not valid"));
});

test("Remove player asks for the party and lists only that party's people; removing leaves the other party alone", async () => {
  const { d, id, sql, p1, p2 } = await setup();
  await claimSlot(sql, { contentId: id, slotId: p1[0]!.id, userId: A, guildId: G, now: NOW });
  await claimSlot(sql, { contentId: id, slotId: p2[0]!.id, userId: B, guildId: G, now: NOW });
  await joinWaitlist(sql, { contentId: id, userId: C, guildId: G, role: "Tank", now: NOW, party: 2 });
  const r1: any = await d(button(`rm:${id}`));
  assert.deepEqual(choice(r1), [["Party 1", `rm:g:${id}`], ["Party 2", `rm:g:${id}@2`]]);
  const r2: any = await d(button(`rm:g:${id}@2`));
  assert.equal(r2.type, 7);
  assert.deepEqual(opts(r2).map((o: any) => o.value), [B, C]);
  assert.equal(r2.data.components[0].components[0].custom_id, `rm:p:${id}@2`);
  assert.ok(opts(r2)[0].description.includes("Position 1"));
  // A party 1 player cannot be removed through the party 2 menu.
  const no: any = await d(menu(`rm:p:${id}@2`, [A]));
  assert.ok(String(no.data.content).includes("not on the roster"));
  const ok: any = await d(menu(`rm:p:${id}@2`, [B]));
  assert.ok(String(ok.data.content).includes("removed"));
  const rows = await sql`select user_id from signup where content_id = ${id} order by user_id`;
  assert.deepEqual(rows.map((r: any) => r.user_id), [A, C]);
});

test("Remove player with one party skips the choice", async () => {
  const { d, id, sql, p1 } = await setup(false);
  await claimSlot(sql, { contentId: id, slotId: p1[0]!.id, userId: A, guildId: G, now: NOW });
  const r: any = await d(button(`rm:${id}`));
  assert.equal(r.type, 4);
  assert.equal(r.data.components[0].components[0].custom_id, `rm:p:${id}`);
});

test("Set duty asks for the party and lists that party's positions", async () => {
  const { d, id, p1, p2, sql } = await setup();
  const r1: any = await d(button(`dt:${id}`));
  assert.deepEqual(choice(r1), [["Party 1", `dt:g:${id}`], ["Party 2", `dt:g:${id}@2`]]);
  const r2: any = await d(button(`dt:g:${id}@2`));
  assert.equal(r2.type, 7);
  assert.deepEqual(opts(r2).map((o: any) => o.value), p2.map((s) => String(s.position)));
  assert.deepEqual(opts(r2).map((o: any) => o.label.split(".")[0]), ["1", "2", "3"]);
  assert.equal(r2.data.components[0].components[0].custom_id, `dt:p:${id}@2`);
  const r3: any = await d(menu(`dt:p:${id}@2`, [String(p2[1]!.position)]));
  assert.equal(r3.data.components[1].components[0].custom_id, `dt:d:${id}:${p2[1]!.position}@2`);
  // a party 1 position through the party 2 menu is refused
  const bad: any = await d(menu(`dt:p:${id}@2`, ["1"]));
  assert.ok(String(bad.data.content).includes("out of date"));
  const duty = async (position: number) => (await sql`select duty from slot where content_id = ${id} and position = ${position}`)[0]!.duty;
  const r4: any = await d(menu(`dt:d:${id}:${p2[1]!.position}@2`, ["caller"]));
  assert.equal(r4.type, 7, JSON.stringify(r4.data));
  assert.ok(String(r4.data.content).startsWith("✅"), String(r4.data.content));
  assert.ok(String(r4.data.content).includes("for position 2."), "the displayed number, not the content-wide one");
  assert.equal(await duty(p2[1]!.position), "caller");
  // a party 1 position through the party 2 duty menu is refused and nothing changes
  const cross: any = await d(menu(`dt:d:${id}:${p1[0]!.position}@2`, ["caller"]));
  assert.ok(String(cross.data.content).includes("in this party"), String(cross.data.content));
  assert.equal(await duty(p1[0]!.position), null);
});

test("Set weapon asks for the party and lists that party's positions without a weapon", async () => {
  const { d, id, p1, p2 } = await setup();
  const r1: any = await d(button(`sw:${id}`));
  assert.deepEqual(choice(r1), [["Party 1", `sw:g:${id}`], ["Party 2", `sw:g:${id}@2`]]);
  const r2: any = await d(button(`sw:g:${id}@2`));
  assert.deepEqual(opts(r2).map((o: any) => o.value), [String(p2[0]!.position)]);
  assert.equal(opts(r2)[0].label.split(".")[0], "1");
  assert.equal(r2.data.components[0].components[0].custom_id, `sw:p:${id}@2`);
  const r3: any = await d(menu(`sw:p:${id}@2`, [String(p2[0]!.position)]));
  assert.equal(r3.data.components[1].components[0].custom_id, `sw:c:${id}:${p2[0]!.position}@2`);
  const bad: any = await d(menu(`sw:p:${id}@2`, [String(p1[0]!.position)]));
  assert.ok(String(bad.data.content).includes("out of date"));
});

test("Set weapon and Set duty with one party skip the choice", async () => {
  const { d, id } = await setup(false);
  const a: any = await d(button(`sw:${id}`));
  assert.equal(a.data.components[0].components[0].custom_id, `sw:p:${id}`);
  const b: any = await d(button(`dt:${id}`));
  assert.equal(b.data.components[0].components[0].custom_id, `dt:p:${id}`);
});

test("/content me on a CTA lists one party at a time (at most 25 options) and switches with Party buttons", async () => {
  const { d, id, p2 } = await setup();
  const r: any = await d({ ...button(`me:pp:${id}@2`, A) });
  assert.equal(r.type, 7);
  const select = r.data.components.find((row: any) => row.components[0].type === 3).components[0];
  assert.equal(select.custom_id, `me:pick:${id}@2`);
  assert.deepEqual(select.options.map((o: any) => o.value), p2.map((s) => s.id));
  assert.ok(select.options.length <= 25);
  const picked: any = await d(menu(`me:pick:${id}@2`, [p2[0]!.id], A));
  assert.equal(picked.type, 7);
});
