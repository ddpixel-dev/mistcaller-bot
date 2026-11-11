import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setPartyMessageId } from "../../src/db/content.ts";
import { getAttendance } from "../../src/db/attendance.ts";
import { renderAttendanceForm } from "../../src/render/attendance.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import { IS_COMPONENTS_V2 } from "../../src/render/roster.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";

// Every number a member reads is the one the roster shows: it restarts at 1 in party 2 (FR-070).
const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 40 * 60000);
const G = "g1";
const [A, B] = ["100000000000000001", "100000000000000002"];
const posts: string[] = [];
const rest: Rest = {
  async createMessage(_c, body) { posts.push(String((body as any).content)); return { id: "m" }; },
  async editMessage() {},
  async deleteMessage() {},
};
beforeEach(async () => { posts.length = 0; await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

// Party 1: Tank, DPS (positions 1, 2). Party 2: Tank, Healer without a weapon (positions 3, 4; shown 1, 2). Positions are sorted by role.
async function setup(cta = true) {
  const sql = await testSql();
  const id = await createContent(sql, {
    guildId: G, threadId: "t1", type: "pvp", title: "CTA", notes: null, startsAt: START, tier: "T8", hasLoot: false,
    createdBy: "9", now: NOW, cta,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "DPS", weapon: cta ? "Bow" : "" }],
    ...(cta ? { slots2: [{ role: "Healer", weapon: "" }, { role: "Tank", weapon: "Mace" }] } : {}),
  });
  await sql`update content set message_id = 'm1' where id = ${id}`;
  if (cta) await setPartyMessageId(sql, { guildId: G, contentId: id, party: 2, messageId: "m2" });
  const v = (await getRosterView(sql, id, NOW))!;
  const deps: Deps = { sql, rest, now: () => NOW };
  return { sql, id, d: createDispatch(deps), p1: v.slots.filter((s) => s.party === 1).map((s) => s.id), p2: v.slots.filter((s) => s.party === 2).map((s) => s.id) };
}
const base = (user: string): Interaction => ({ id: "i", type: 3, application_id: "a", token: "t", guild_id: G, message: { id: "m", flags: IS_COMPONENTS_V2 }, member: { user: { id: user }, roles: [] } });
const menu = (customId: string, values: unknown, user: string): Interaction => ({ ...base(user), data: { custom_id: customId, component_type: 3, values } });
const button = (customId: string, user: string): Interaction => ({ ...base(user), data: { custom_id: customId, component_type: 2 } });
const seat = (sql: any, id: string, user: string, slot: string, party: number) =>
  sql`insert into signup (guild_id, content_id, user_id, slot_id, status, party) values (${G}, ${id}, ${user}, ${slot}, 'signed', ${party})`;

test("the weapon picker names the shown number and the party", async () => {
  const { id, p2, d } = await setup();
  const r: any = await d(menu(`join:${id}@2`, [p2[1]], A));
  assert.ok(r.data.content.includes("You are in **Party 2 · 2. Healer**"), r.data.content);
});

test("one party: the weapon picker keeps its text", async () => {
  const { id, p1, d } = await setup(false);
  const r: any = await d(menu(`join:${id}`, [p1[1]], A));
  assert.ok(r.data.content.includes("You are in **2. DPS**"), r.data.content);
});

test("an application for a party 2 position names the shown number and the party", async () => {
  const { sql, id, p2, d } = await setup();
  await sql`update content set selection = true`;
  const r: any = await d(menu(`join:${id}@2`, [p2[1]], A));
  assert.ok(r.data.content.includes("You applied for Party 2, position 2 (Healer)"), r.data.content);
});

test("a waitlist promotion in party 2 names the shown number and the party", async () => {
  const { sql, id, p2, d } = await setup();
  await seat(sql, id, B, p2[0]!, 2);
  await d(menu(`wait:${id}@2`, ["Tank"], A));
  await d(button(`leave:${id}@2`, B));
  const line = posts.find((p) => p.includes(`<@${A}>`));
  assert.ok(line?.includes("**Party 2 · 1. Tank - Mace**"), String(line));
});

test("a fill seated in party 2 is told the shown number and party, privately and in the post", async () => {
  const { id, p2, d } = await setup();
  const r: any = await d(menu(`fp:${id}@2`, [`s:${p2[1]}`], A));
  assert.ok(r.data.content.includes("You are seated in Party 2, position 2 (Healer)"), r.data.content);
  const line = posts.find((p) => p.includes("joined as fill"))!;
  assert.ok(line.includes("(\\#2)") && line.includes("seated in Party 2, position 2 · Healer"), line);
});

test("one party: a fill seated keeps its text", async () => {
  const { id, d } = await setup(false);
  const r: any = await d(menu(`fp:${id}`, ["any"], A));
  assert.ok(r.data.content.startsWith("✅ You are seated in position 1 (Tank)"), r.data.content);
  assert.ok(posts.some((p) => p.includes("seated in position 1 · Tank")));
});

test("a waiting fill promoted in party 2 names the shown number and party", async () => {
  const { sql, id, p2, d } = await setup();
  await seat(sql, id, B, p2[0]!, 2);
  await seat(sql, id, "100000000000000003", p2[1]!, 2);
  await d(menu(`fp:${id}@2`, ["any"], A));
  await d(button(`leave:${id}@2`, B));
  const line = posts.find((p) => p.includes("joined as fill"))!;
  assert.ok(line.includes("seated in Party 2, position 1 · Tank"), line);
});

test("the party 2 attendance menu labels use the shown number", async () => {
  const { sql, id, p2 } = await setup();
  await seat(sql, id, A, p2[1]!, 2);
  const a = (await getAttendance(sql, id))!;
  const form = renderAttendanceForm(a, { [A]: "Ann" }, 2) as any;
  assert.equal(form.components[0].components[0].options[0].label, "2. Ann");
});
