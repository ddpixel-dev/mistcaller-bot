import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, getRosterView, setMessageId } from "../../src/db/content.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { discordProblems, flatComponents, plain, textOf } from "../helpers/discordLimits.ts";

const START = new Date("2026-12-01T18:00:00Z");
const NOW = new Date(START.getTime() - 60 * 60000);
const [OWNER, A, B, STRANGER] = ["100000000000000001", "100000000000000002", "100000000000000003", "100000000000000005"];
const V2 = 1 << 15;
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup(selection = true) {
  const sql = await testSql();
  const id = await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvp", title: "Raid", notes: null, startsAt: START, tier: "T8", hasLoot: false, createdBy: OWNER, now: NOW, selection,
    slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }, { role: "DPS", weapon: "Bow" }],
  });
  await setMessageId(sql, id, "m1");
  const slots = (await getRosterView(sql, id, NOW))!.slots.map((s) => s.id);
  const edits: any[] = [], posts: { channel: string; body: any }[] = [];
  const rest: Rest = {
    async createMessage(channel, body) { posts.push({ channel, body }); return { id: "x" }; },
    async editMessage(_c, _m, body) { edits.push(body); },
    async deleteMessage() {},
    async memberName(_g, u) { return `Name-${u.slice(-1)}`; },
  };
  const deps: Deps = { sql, rest, now: () => NOW };
  return { sql, id, slots, d: createDispatch(deps), edits, posts };
}
const click = (customId: string, user: string, values?: unknown[], over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1", channel: { id: "t1", type: 11 },
  message: { id: "m1", flags: V2 }, member: { user: { id: user }, roles: [] },
  data: { custom_id: customId, component_type: values ? 3 : 2, ...(values ? { values } : {}) }, ...over,
});
const PANEL = { message: { id: "p1", flags: 64 } };
const ROSTER_BUTTON = [{ type: 1, components: [{ type: 2, style: 5, label: "Roster", emoji: { name: "📋" }, url: "https://discord.com/channels/g1/t1/m1" }] }];
const text = (r: any) => String(r.data.content ?? "");
const labels = (r: any) => flatComponents(r.data).filter((c) => c.type === 2).map((c) => c.label);

test("applying for a position answers privately, seats nobody, refreshes the roster and lists the applicant", async () => {
  const { d, id, slots, sql, edits } = await setup();
  const r: any = await d(click(`join:${id}`, A, [slots[1]!]));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.ok(text(r).includes("You applied for position 2") && text(r).includes("host picks the party"));
  const v = (await getRosterView(sql, id, NOW))!;
  assert.equal(v.slots.filter((s) => s.userId).length, 0);
  assert.deepEqual(v.applicants!.map((a) => [a.userId, a.wants]), [[A, "#2"]]);
  assert.ok(plain(textOf(edits.at(-1))).includes(`📨 **Applicants (1):** <@${A}> (\\#2)`));
});

test("Fill in a selection event is an application too, with the player's choices", async () => {
  const { d, id, sql, posts } = await setup();
  const r: any = await d(click(`fp:${id}`, A, ["r:Healer", "r:Tank"]));
  assert.ok(text(r).includes("You applied (Healer, Tank)"));
  assert.deepEqual((await getRosterView(sql, id, NOW))!.applicants!.map((a) => [a.userId, a.wants]), [[A, "Healer, Tank"]]);
  assert.equal(posts.length, 0, "nothing is posted until the host decides");
});

test("a selection event has Review applicants (applicants only) and Assign player (any member, no applicants)", async () => {
  const { d, id, slots, sql, posts } = await setup();
  await d(click(`join:${id}`, A, [slots[1]!]));
  const manage: any = await d(click(`mg:${id}`, OWNER, undefined, { message: { id: "m1", flags: V2 } }));
  assert.ok(labels(manage).some((l) => l?.startsWith("Review applicants (1)")), labels(manage).join("|"));
  assert.ok(labels(manage).includes("Assign player") && !labels(manage).includes("Add player"));
  assert.deepEqual(discordProblems({ ...manage.data, flags: 0 }), []);

  // Review applicants: the applicants only, no member picker.
  const panel: any = await d(click(`fa:r:${id}`, OWNER, undefined, PANEL));
  const menu = panel.data.components[0].components[0];
  assert.equal(menu.custom_id, `fa:q:${id}`);
  assert.deepEqual(menu.options.map((o: any) => [o.label, o.value, o.description]), [["Name-2", A, "Applied: #2"]]);
  assert.ok(!panel.data.components.some((r: any) => r.components[0].type === 5), "no member picker in Review applicants");
  assert.deepEqual(discordProblems({ ...panel.data, flags: 0 }), []);

  // Assign player: a member picker, and the applicants are not listed there.
  const assign: any = await d(click(`fa:${id}`, OWNER, undefined, PANEL));
  assert.deepEqual(assign.data.components.map((r: any) => r.components[0].type), [5]);
  assert.ok(!JSON.stringify(assign.data).includes(A));

  const chosen: any = await d(click(`fa:q:${id}`, OWNER, [A], PANEL));
  const positions = chosen.data.components.at(-1).components[0];
  const done: any = await d(click(`fa:s:${id}:${A}`, OWNER, [positions.options[0].value], PANEL));
  assert.ok(text(done).includes(`<@${A}>`));
  const v = (await getRosterView(sql, id, NOW))!;
  assert.equal(v.slots[1]!.userId, A);
  assert.deepEqual(v.applicants, []);
  assert.equal(posts[0]!.body.content, `✅ <@${OWNER}> accepted <@${A}> for position 2 (💚 Healer).`);
});

test("Review applicants is dimmed while nobody has applied, and its panel says so", async () => {
  const { d, id } = await setup();
  const manage: any = await d(click(`mg:${id}`, OWNER, undefined, { message: { id: "m1", flags: V2 } }));
  const review = flatComponents(manage.data).find((c) => String(c.label).startsWith("Review applicants"))!;
  assert.equal(review.disabled, true);
  const panel: any = await d(click(`fa:r:${id}`, OWNER, undefined, PANEL));
  assert.ok(text(panel).includes("Nobody has applied"));
});

test("declining is Remove player: the application goes and the applicant is told in the post", async () => {
  const { d, id, slots, sql, posts } = await setup();
  await d(click(`join:${id}`, B, [slots[0]!]));
  const panel: any = await d(click(`rm:${id}`, OWNER, undefined, PANEL));
  assert.deepEqual(panel.data.components[0].components[0].options.map((o: any) => [o.value, o.description]), [[B, "Applicant · #1"]]);
  const done: any = await d(click(`rm:p:${id}`, OWNER, [B], PANEL));
  assert.ok(text(done).includes("was removed"));
  assert.deepEqual((await getRosterView(sql, id, NOW))!.applicants, []);
  assert.ok(posts[0]!.body.content.includes(`<@${B}>, your application for **Raid** was declined by <@${OWNER}>.`), posts[0]!.body.content);
  assert.deepEqual(posts[0]!.body.allowed_mentions, { users: [B] });
});

test("a seated player cannot move themselves in a selection event, and an applicant can withdraw with Leave", async () => {
  const { d, id, slots, sql } = await setup();
  await d(click(`join:${id}`, A, [slots[0]!]));
  await d(click(`leave:${id}`, A));
  assert.deepEqual((await getRosterView(sql, id, NOW))!.applicants, []);
  const { assignPlayer } = await import("../../src/db/signup.ts");
  await assignPlayer(sql, { contentId: id, guildId: "g1", userId: B, slotId: slots[0]!, now: NOW });
  assert.ok(text(await d(click(`join:${id}`, B, [slots[2]!]))).includes("only the host can move you"));
  assert.ok(text(await d(click(`fp:${id}`, B, ["any"]))).includes("only the host can move you"));
});

test("the Edit panel switches selection on and off; off is refused while applicants wait", async () => {
  const { d, id, slots, sql } = await setup(false);
  const edit: any = await d(click(`mg:e:${id}`, OWNER));
  const sel = flatComponents(edit.data).find((c) => c.custom_id === `ed:s:${id}`)!;
  assert.deepEqual(sel.options.map((o: any) => [o.value, !!o.default]), [["0", true], ["1", false]]);
  const on: any = await d(click(`ed:s:${id}`, OWNER, ["1"], PANEL));
  assert.ok(text(on).includes("Selection on"));
  assert.equal((await getRosterView(sql, id, NOW))!.selection, true);
  await d(click(`join:${id}`, A, [slots[0]!]));
  assert.ok(text(await d(click(`ed:s:${id}`, OWNER, ["0"], PANEL))).includes("Accept or decline them first"));
  assert.equal((await getRosterView(sql, id, NOW))!.selection, true);
  assert.ok(text(await d(click(`ed:s:${id}`, STRANGER, ["0"], PANEL))).includes("Only the creator"));
});

test("a normal event has Assign player, no Review applicants and no disclaimer", async () => {
  const { d, id, edits } = await setup(false);
  const manage: any = await d(click(`mg:${id}`, OWNER));
  assert.ok(labels(manage).includes("Assign player") && !labels(manage).some((l) => l?.startsWith("Review applicants")));
  assert.ok(edits.length === 0);
});

test("the host sees only the open positions that suit what the applicant or the fill asked for", async () => {
  const { d, id, slots, sql } = await setup();
  await d(click(`fp:${id}`, A, ["r:Healer"]));
  await d(click(`join:${id}`, B, [slots[0]!]));
  const forA: any = await d(click(`fa:p:${id}`, OWNER, [A], PANEL));
  const optsA = forA.data.components.at(-1).components[0].options;
  assert.deepEqual(optsA.map((o: any) => o.label), ["2. Healer - Holy"], "A asked for Healer only");
  assert.ok(text(forA).includes("only the open positions that suit"));
  const forB: any = await d(click(`fa:p:${id}`, OWNER, [B], PANEL));
  assert.deepEqual(forB.data.components.at(-1).components[0].options.map((o: any) => o.label), ["1. Tank - Mace"], "B applied for position 1");
  const anyone: any = await d(click(`fa:u:${id}`, OWNER, [STRANGER], PANEL));
  assert.equal(anyone.data.components.at(-1).components[0].options.length, 3, "any other member can go anywhere");
  await assignPlayerFor(sql, id, slots[1]!, STRANGER);
  const none: any = await d(click(`fa:p:${id}`, OWNER, [A], PANEL));
  assert.ok(text(none).includes("No open position suits what"));
  assert.ok(!none.data.components.some((r: any) => r.components[0].custom_id.startsWith("fa:s:")));
});
async function assignPlayerFor(sql: any, id: string, slotId: string, userId: string) {
  const { assignPlayer } = await import("../../src/db/signup.ts");
  await assignPlayer(sql, { contentId: id, guildId: "g1", userId, slotId, now: NOW });
}
