import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView } from "../../src/db/content.ts";
import { claimSlot } from "../../src/db/signup.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import { commands } from "../../src/discord/commands.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { discordProblems, plain, textOf } from "../helpers/discordLimits.ts";

const NOW = new Date("2026-10-15T12:00:00Z");
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

const rest: Rest = { async createMessage() { return { id: "x" }; }, async editMessage() {}, async deleteMessage() {} };
async function setup() {
  const sql = await testSql();
  const deps: Deps = { sql, rest, now: () => NOW };
  return { sql, d: createDispatch(deps) };
}
const stats = (user = "anyone", guild = "g1", over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 2, application_id: "a", token: "t", guild_id: guild, channel_id: "c1", member: { user: { id: user }, roles: [], permissions: "0" },
  data: { name: "content", options: [{ name: "stats", type: 1 }] }, ...over,
});
async function event(sql: any, guildId: string, threadId: string, user?: string) {
  const id = await createContent(sql, {
    guildId, threadId, type: "pvp", kind: "zvz", title: threadId, notes: null, startsAt: new Date(NOW.getTime() + 3600000), tier: "T8", hasLoot: false,
    createdBy: "boss", now: NOW, slots: [{ role: "Tank", weapon: "Mace" }, { role: "DPS", weapon: "Bow" }],
  });
  if (user) {
    const slot = (await getRosterView(sql, id, NOW))!.slots[0]!.id;
    await claimSlot(sql, { contentId: id, slotId: slot, userId: user, guildId, now: NOW });
  }
}

test("anyone can ask for the statistics and the answer is private", async () => {
  const { d, sql } = await setup();
  await event(sql, "g1", "t1", "p1");
  const r: any = await d(stats("a-plain-member"));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, (1 << 15) | 64, "a Components V2 message that only the asker sees");
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
  const t = plain(textOf(r.data));
  assert.ok(t.includes("Statistics") && t.includes("• Created: **1**") && t.includes("<@p1>"));
  assert.deepEqual(discordProblems({ ...r.data, flags: 1 << 15 }), []);
});

test("it counts only the server it is used in, and an empty server gets the first-event message", async () => {
  const { d, sql } = await setup();
  await event(sql, "g1", "t1");
  await event(sql, "g2", "t2");
  await event(sql, "g2", "t3");
  assert.ok(plain(textOf(((await d(stats("u", "g1"))) as any).data)).includes("• Created: **1**"));
  assert.ok(plain(textOf(((await d(stats("u", "g2"))) as any).data)).includes("• Created: **2**"));
  assert.ok(plain(textOf(((await d(stats("u", "g3"))) as any).data)).includes("No events yet"));
});

test("it needs a server: a direct message is told to use it in the server", async () => {
  const { d } = await setup();
  const r: any = await d(stats("u", undefined as any, { guild_id: undefined, member: undefined, user: { id: "u" } }));
  assert.equal(r.data.flags, 64);
  assert.ok(String(r.data.content).includes("inside the server"));
});

test("the command is registered and the statistics channel options are gone", () => {
  const sub = (commands[0] as any).options as { name: string; options?: { name: string }[] }[];
  assert.ok(sub.some((o) => o.name === "stats"));
  const setupOptions = sub.find((o) => o.name === "setup")!.options!.map((o) => o.name);
  assert.deepEqual(setupOptions, ["calendar-channel", "clear-calendar"]);
});
