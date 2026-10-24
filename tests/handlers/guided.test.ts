import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent } from "../../src/db/content.ts";
import { getDraft } from "../../src/db/draft.ts";
import { handleCreateModal } from "../../src/handlers/create.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";
import { WEAPONS } from "../../src/data/weapons.ts";
import { weaponClass } from "../../src/domain/weapons.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const rest: Rest = { async createMessage() { return { id: "m1" }; }, async editMessage() {}, async deleteMessage() {} };
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup() {
  const sql = await testSql();
  const deps: Deps = { sql, rest, now: () => NOW };
  return { sql, deps, d: createDispatch(deps) };
}
const base = (over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1", channel_id: "t1",
  channel: { id: "t1", type: 11, parent_id: "fp" }, member: { user: { id: "u1" }, roles: [] }, ...over,
});
const press = (customId: string, values?: unknown[], over: Partial<Interaction> = {}) =>
  base({ data: { custom_id: customId, component_type: values ? 3 : 2, ...(values ? { values } : {}) }, ...over });
const form = (customId: string, fields: Record<string, string>, over: Partial<Interaction> = {}) =>
  base({
    type: 5,
    data: { custom_id: customId, components: Object.entries(fields).map(([custom_id, value]) => ({ type: 1, components: [{ type: 4, custom_id, value }] })) },
    ...over,
  });
const create = (over: Partial<Interaction> = {}) => base({ type: 2, data: { name: "content", options: [{ name: "create", type: 1 }] }, ...over });
const embed = (r: any) => r.data.embeds[0];
const all = (r: any) => r.data.components.flatMap((row: any) => row.components);
const find = (r: any, prefix: string) => all(r).find((c: any) => c.custom_id.startsWith(prefix));
const refused = (r: any) => r.data.flags === 64 && r.data.content.includes("expired or are not yours");

// The creation card -> Guided slots -> the number menu -> the first slot card (ADR 0032). The draft id is the card's.
async function begin(d: any, count: string | null = "5") {
  const opened: any = await d(create());
  const id = opened.data.components.at(-1).components[0].custom_id.split(":")[2] as string;
  let card: any = await d(press(`cc:guided:${id}`));
  if (count) card = await d(press(`gs:setcount:${id}`, [count]));
  return { id, card, opened };
}

// Fill the current card the way a member does: role, then (optional) the weapon's class and the weapon, then duty, then Next.
async function fillCard(d: any, id: string, role: string, weapon?: string, duty?: string) {
  await d(press(`gs:role:${id}`, [role]));
  if (weapon) {
    const w = WEAPONS.find((x) => x.name === weapon)!;
    await d(press(`gs:class:${id}`, [weaponClass(w)]));
    await d(press(`gs:weapon:${id}`, [w.base]));
  }
  if (duty) await d(press(`gs:duty:${id}`, [duty]));
  return await d(press(`gs:next:${id}`));
}

test("Guided slots on the creation card asks the number with a menu, then shows card 1", async () => {
  const { sql, d } = await setup();
  const opened: any = await d(create());
  const id = opened.data.components.at(-1).components[0].custom_id.split(":")[2];
  const pick: any = await d(press(`cc:guided:${id}`));
  assert.equal(pick.type, 7);
  assert.ok(embed(pick).description.includes("Pick a number"));
  const menu = find(pick, "gs:setcount");
  assert.deepEqual(menu.options.map((o: any) => o.value), Array.from({ length: 20 }, (_, n) => String(n + 1)));
  const card: any = await d(press(`gs:setcount:${id}`, ["5"]));
  assert.ok(embed(card).description.includes("Slot 1 of 5"));
  assert.equal((await getDraft(sql, id, NOW))!.count, 5);
});

test("a valid number shows slot card 1 with three lists with placeholders, then the buttons", async () => {
  const { d } = await setup();
  const { id, card } = await begin(d, "5");
  assert.equal(card.type, 7);
  assert.ok(embed(card).description.includes("Slot 1 of 5"));
  const role = find(card, "gs:role");
  const weapon = find(card, "gs:weapon");
  const duty = find(card, "gs:duty");
  assert.deepEqual([role.placeholder, weapon.placeholder, duty.placeholder], ["Role (pick one)", "Weapon (pick a class first)", "Duty (optional)"]);
  assert.deepEqual(role.options.map((o: any) => o.label), ["Tank", "DTank", "Healer", "Support", "DPS"]);
  assert.equal(weapon.disabled, true);
  assert.deepEqual(weapon.options.map((o: any) => o.label), ["Pick a weapon class first"]);
  const cls = find(card, "gs:class");
  assert.equal(cls.placeholder, "Weapon class (optional)");
  assert.deepEqual(cls.options.map((o: any) => o.label), ["Sword", "Axe", "Hammer", "Mace", "Spear", "Dagger", "Quarterstaff", "Bow", "Crossbow", "Gloves", "Fire Staff", "Frost Staff", "Holy Staff", "Arcane Staff", "Cursed Staff", "Nature Staff", "Shapeshifter", "Off-hand"]);
  assert.ok(cls.options.every((o: any) => !o.default));
  assert.equal(card.data.components.length, 5);
  assert.deepEqual(duty.options.map((o: any) => o.label), ["Caller", "Scout", "Rat", "Looter", "Catcher"]);
  assert.deepEqual([duty.min_values, duty.max_values], [0, 1]);
  assert.ok([role, weapon, duty].every((s: any) => s.options.every((o: any) => !o.default)));
  const buttons = card.data.components[4].components;
  assert.deepEqual(buttons.map((b: any) => [b.label, !!b.disabled]), [["Next", true], ["Back", false], ["Same as previous", true], ["Fill the rest", true], ["Cancel", false]]);
  assert.ok(buttons.every((b: any) => b.custom_id.endsWith(id)));
});

test("the number menu refuses anything but 1 to 20 and changes nothing", async () => {
  const { sql, d } = await setup();
  const { id } = await begin(d, null);
  for (const v of ["0", "21", "abc", "2.5", "-1"]) {
    const r: any = await d(press(`gs:setcount:${id}`, [v]));
    assert.equal(r.data.flags, 64, v);
  }
  assert.equal((await getDraft(sql, id, NOW))!.count, null);
});

test("picking role, weapon and duty on the card enables Next; Next saves the slot and shows card 2", async () => {
  const { sql, d } = await setup();
  const { id } = await begin(d, "3");
  let r: any = await d(press(`gs:role:${id}`, ["Tank"]));
  assert.deepEqual(find(r, "gs:role").options.filter((o: any) => o.default).map((o: any) => o.value), ["Tank"]);
  assert.equal(find(r, "gs:next").disabled, false, "a role alone is enough: the weapon is optional");
  r = await d(press(`gs:class:${id}`, ["Axe"]));
  const weaponBase = find(r, "gs:weapon").options[1].value;
  assert.equal(find(r, "gs:weapon").disabled, false);
  r = await d(press(`gs:weapon:${id}`, [weaponBase]));
  assert.equal(find(r, "gs:next").disabled, false);
  assert.match(embed(r).thumbnail.url, /render\.albiononline\.com\/v1\/item\/T\d_.*\.png\?size=128/);
  r = await d(press(`gs:duty:${id}`, ["caller"]));
  assert.ok(embed(r).description.includes("This slot: Tank"));
  r = await d(press(`gs:next:${id}`));
  assert.ok(embed(r).description.includes("Slot 2 of 3"));
  assert.ok(embed(r).description.includes("1. Tank - "));
  assert.ok(embed(r).description.includes("📯 Caller"));
  const stored = (await getDraft(sql, id, NOW))!;
  assert.equal(stored.slots[0]!.duty, "caller");
  assert.deepEqual([stored.role, stored.weapon, stored.duty, stored.step], [null, null, null, 1]);
});

test("deselecting the duty clears it, since there is no None entry", async () => {
  const { sql, d } = await setup();
  const { id } = await begin(d, "2");
  let r: any = await d(press(`gs:duty:${id}`, ["rat"]));
  assert.deepEqual(find(r, "gs:duty").options.filter((o: any) => o.default).map((o: any) => o.value), ["rat"]);
  r = await d(press(`gs:duty:${id}`, []));
  assert.deepEqual(find(r, "gs:duty").options.filter((o: any) => o.default), []);
  assert.equal((await getDraft(sql, id, NOW))!.duty, null);
  assert.ok(!JSON.stringify(find(r, "gs:duty").options).includes("None"));
});

test("picking a weapon class fills the Weapon list with just that class, sorted, and no form pops up", async () => {
  const { sql, d } = await setup();
  const { id } = await begin(d, "2");
  let r: any = await d(press(`gs:class:${id}`, ["Holy Staff"]));
  assert.equal(r.type, 7);
  assert.deepEqual(find(r, "gs:class").options.filter((o: any) => o.default).map((o: any) => o.value), ["Holy Staff"]);
  const weapon = find(r, "gs:weapon");
  assert.equal(weapon.disabled, false);
  assert.equal(weapon.placeholder, "Weapon (optional)");
  const labels = weapon.options.map((o: any) => o.label);
  assert.ok(labels.length > 1 && labels.length <= 25);
  assert.deepEqual(labels, [...labels].sort((a: string, b: string) => a.localeCompare(b)));
  assert.ok(labels.some((l: string) => l.startsWith("Great Holy Staff")));
  assert.ok(!all(r).some((c: any) => c.label === "Search weapon"));
  const off: any = await d(press(`gs:class:${id}`, ["Off-hand"]));
  assert.ok(find(off, "gs:weapon").options.some((o: any) => o.label.startsWith("Shield")));
  assert.ok(find(off, "gs:weapon").options.every((o: any) => !o.label.startsWith("Great Holy Staff")));
  assert.equal((await getDraft(sql, id, NOW))!.weaponClass, "Off-hand");
  assert.equal(((await d(press(`gs:class:${id}`, ["Wand"]))) as any).data.flags, 64);
});

test("picking a weapon puts it on the card with its icon and keeps the class; Next resets both", async () => {
  const { sql, d } = await setup();
  const { id } = await begin(d, "2");
  let r: any = await d(press(`gs:class:${id}`, ["Bow"]));
  const pick = find(r, "gs:weapon").options.find((o: any) => o.label.startsWith("Longbow"));
  r = await d(press(`gs:weapon:${id}`, [pick.value]));
  assert.ok(embed(r).description.includes("Longbow"));
  assert.match(embed(r).thumbnail.url, /T\d_2H_LONGBOW\.png/);
  assert.deepEqual(find(r, "gs:weapon").options.filter((o: any) => o.default).map((o: any) => o.label.split(" (")[0]), ["Longbow"]);
  r = await d(press(`gs:role:${id}`, ["DPS"]));
  r = await d(press(`gs:next:${id}`));
  assert.equal((await getDraft(sql, id, NOW))!.weaponClass, null);
  assert.equal(find(r, "gs:weapon").disabled, true);
  assert.deepEqual(find(r, "gs:class").options.filter((o: any) => o.default), []);
  r = await d(press(`gs:back:${id}`));
  assert.deepEqual(find(r, "gs:class").options.filter((o: any) => o.default).map((o: any) => o.value), ["Bow"]);
});

test("Back goes to the previous card with its saved choices; Same as previous fills the card; Fill the rest completes", async () => {
  const { d } = await setup();
  const { id } = await begin(d, "4");
  await fillCard(d, id, "Tank", "Broadsword", "caller");
  let r: any = await d(press(`gs:same:${id}`));
  assert.deepEqual(find(r, "gs:role").options.filter((o: any) => o.default).map((o: any) => o.value), ["Tank"]);
  assert.deepEqual(find(r, "gs:duty").options.filter((o: any) => o.default).map((o: any) => o.value), ["caller"]);
  r = await d(press(`gs:back:${id}`));
  assert.ok(embed(r).description.includes("Slot 1 of 4"));
  assert.deepEqual(find(r, "gs:role").options.filter((o: any) => o.default).map((o: any) => o.value), ["Tank"]);
  await d(press(`gs:next:${id}`));
  await d(press(`gs:role:${id}`, ["DPS"]));
  r = await d(press(`gs:class:${id}`, ["Bow"]));
  r = await d(press(`gs:weapon:${id}`, [find(r, "gs:weapon").options[0].value]));
  r = await d(press(`gs:rest:${id}`));
  assert.ok(embed(r).description.includes("All 4 slots are chosen."));
  assert.deepEqual(r.data.components[0].components.map((b: any) => b.label), ["Use these slots", "Back", "Change number", "Cancel"]);
});

test("Back on the first card, or Back to the card on the number menu, returns to the creation card", async () => {
  const { d } = await setup();
  const { id } = await begin(d, "3");
  const r: any = await d(press(`gs:back:${id}`));
  assert.equal(r.type, 7);
  assert.ok(r.data.content.includes("Create event"));
  assert.deepEqual(r.data.embeds, []);
  assert.ok(all(r).some((c: any) => c.custom_id === `cc:create:${id}`));
  const menu: any = await d(press(`gs:count:${id}`));
  const back: any = await d(press(`gs:card:${id}`));
  assert.ok(find(menu, "gs:setcount") && back.data.content.includes("Create event"));
});

test("Change number shows the number menu with the current value; a new number trims or extends", async () => {
  const { sql, d } = await setup();
  const { id } = await begin(d, "4");
  await fillCard(d, id, "Tank", "Mace");
  const f: any = await d(press(`gs:count:${id}`));
  assert.deepEqual(find(f, "gs:setcount").options.filter((o: any) => o.default).map((o: any) => o.value), ["4"]);
  const r: any = await d(press(`gs:setcount:${id}`, ["6"]));
  assert.ok(embed(r).description.includes("Slot 2 of 6"));
  assert.equal((await getDraft(sql, id, NOW))!.slots.length, 1);
});

test("Use these slots returns to the creation card with them; Details and Create make the content", async () => {
  const { sql, d } = await setup();
  const { id } = await begin(d, "2");
  await fillCard(d, id, "Tank", "Greataxe", "caller");
  const done: any = await fillCard(d, id, "Healer", "Holy Staff");
  assert.ok(embed(done).description.includes("All 2 slots are chosen."));
  const back: any = await d(press(`gs:done:${id}`));
  assert.equal(back.type, 7);
  assert.ok(back.data.content.includes("1. 🛡️ Tank - Greataxe · 📯 Caller") && back.data.content.includes("2. 💚 Healer - Holy Staff"));
  await d(press(`cc:type:${id}`, ["pvp"]));
  const details: any = await d(press(`cc:details:${id}`));
  const slots = details.data.components.map((row: any) => row.components[0]).find((c: any) => c.custom_id === "slots").value;
  assert.equal(slots, "Tank - Greataxe (Caller)\nHealer - Holy Staff");
  await d(form(`ccd:${id}`, { title: "Raid", start: "2026-10-07 18:00", tier: "T6.0", slots, notes: "" }));
  const made: any = await d(press(`cc:create:${id}`));
  assert.ok(made.data.content.startsWith("✅ Created"), made.data.content);
  const [{ duty }] = await sql`select duty from slot where position = 1`;
  assert.equal(duty, "caller");
});

test("Cancel on a card discards the draft; a create panel from an earlier version says to start again", async () => {
  const { sql, d } = await setup();
  const { id } = await begin(d, "3");
  const gone: any = await d(press(`gs:cancel:${id}`));
  assert.equal(gone.data.content, "Creation cancelled.");
  assert.deepEqual(gone.data.components, []);
  assert.equal(await getDraft(sql, id, NOW), null);
  assert.ok(((await d(form("cf", {}))) as any).data.content.includes("earlier version"), "the 0.25.0 first form");
  for (const cid of ["cpx", "cpgo:pvp:1:zvz:-", "cp:type:-:-:-:-"]) {
    assert.ok(((await d(press(cid, cid.startsWith("cp:") ? ["pvp"] : undefined))) as any).data.content.includes("earlier version"), cid);
  }
});

test("only the owner in the same post can use a draft; expired drafts and tampered ids are refused", async () => {
  const { sql, d } = await setup();
  const { id } = await begin(d, "3");
  assert.ok(refused(await d(press(`gs:role:${id}`, ["Tank"], { member: { user: { id: "u2" }, roles: [] } }))));
  assert.ok(refused(await d(press(`gs:role:${id}`, ["Tank"], { guild_id: "g2" }))));
  assert.ok(refused(await d(press(`gs:role:${id}`, ["Tank"], { channel: { id: "other", type: 11, parent_id: "fp" } }))));
  assert.ok(refused(await d(press(`gs:setcount:${id}`, ["4"], { member: { user: { id: "u2" }, roles: [] } }))));
  assert.ok(refused(await d(press(`gs:class:${id}`, ["Axe"], { member: { user: { id: "u2" }, roles: [] } }))));
  for (const cid of ["gs:role:nope", "gs:role", `gs:zzz:${id}`, `gs:role:${id}:x`, "gs::"]) {
    assert.equal(((await d(press(cid, ["Tank"]))) as any).data.flags, 64, cid);
  }
  assert.equal(((await d(press(`gs:weapon:${id}`, ["NOT_A_WEAPON"]))) as any).data.flags, 64);
  assert.equal(((await d(form(`gsc:${id}:x`, { count: "3" }))) as any).data.flags, 64);
  const before = (await getDraft(sql, id, NOW))!;
  await d(press(`gs:role:${id}`, ["Wizard"]));
  await d(press(`gs:duty:${id}`, ["captain"]));
  assert.deepEqual([(await getDraft(sql, id, NOW))!.role, (await getDraft(sql, id, NOW))!.duty], [before.role, before.duty]);
  await sql`update slot_draft set created_at = ${new Date(NOW.getTime() - 2 * 3600000)}`;
  assert.ok(refused(await d(press(`gs:role:${id}`, ["Tank"]))));
});

test("Create and the command are refused while the post already has content", async () => {
  const { sql, d } = await setup();
  const { id } = await begin(d, "1");
  await fillCard(d, id, "Tank", "Mace");
  await d(press(`gs:done:${id}`));
  await d(press(`cc:type:${id}`, ["pvp"]));
  await d(form(`ccd:${id}`, { title: "Raid", start: "2026-10-07 18:00", tier: "T6.0", slots: "Tank - Mace", notes: "" }));
  await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvp", title: "x", notes: null, startsAt: new Date("2026-12-01T18:00:00Z"),
    tier: "T8.0", hasLoot: false, createdBy: "u3", slots: [{ role: "R", weapon: "W" }],
  });
  for (const r of [await d(press(`cc:create:${id}`)), await d(create())] as any[]) {
    assert.equal(r.data.flags, 64);
    assert.ok(r.data.content.includes("already has content"), r.data.content);
  }
});

import { discordProblems, modalProblems } from "../helpers/discordLimits.ts";

test("every private message in the create and guided flow stays inside Discord's limits", async () => {
  const { sql, d } = await setup();
  await sql`insert into slot_preset (guild_id, name, slots, created_by) select 'g1', 'P' || n, '[{"role":"Tank","weapon":"Mace"}]'::jsonb, 'o' from generate_series(1, 25) n`;
  const seen: any[] = [];
  const run = async (i: Interaction) => { const r: any = await d(i); if (r.data?.components || r.data?.embeds) seen.push(r.data); return r; };
  const opened: any = await run(create());
  const id = opened.data.components.at(-1).components[0].custom_id.split(":")[2];
  await run(press(`cc:type:${id}`, ["pvx"]));
  await run(press(`cc:kind:${id}`, ["avalonian-dungeon"]));
  await run(press(`cc:loot:${id}`, ["1"]));
  await run(press(`cc:guided:${id}`));
  await run(press(`gs:setcount:${id}`, ["20"]));
  await run(press(`gs:role:${id}`, ["Tank"]));
  await run(press(`gs:duty:${id}`, ["caller"]));
  const weapons: any = await run(press(`gs:class:${id}`, ["Bow"]));
  await run(press(`gs:weapon:${id}`, [find(weapons, "gs:weapon").options[0].value]));
  await run(press(`gs:next:${id}`));
  await run(press(`gs:same:${id}`));
  await run(press(`gs:rest:${id}`));
  await run(press(`gs:count:${id}`));
  await run(press(`gs:done:${id}`));
  await run(press(`cc:create:${id}`)); // problems listed on the card
  assert.ok(seen.length >= 12);
  const problems = seen.flatMap((data, n) => discordProblems(data).map((p) => `message ${n}: ${p}`));
  assert.deepEqual(problems, []);
  assert.deepEqual(modalProblems(((await d(press(`cc:details:${id}`))) as any).data), []);
  assert.deepEqual(modalProblems(((await d(press(`cc:build:${id}`))) as any).data), []);
});
