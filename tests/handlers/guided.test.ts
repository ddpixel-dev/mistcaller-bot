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
// The first create form (ADR 0031), sent with its menus in Labels.
type First = { kind?: string; count?: string; preset?: string; tier?: string; loot?: string };
const firstForm = (f: First = {}, over: Partial<Interaction> = {}, customId = "cf") =>
  base({
    type: 5,
    data: {
      custom_id: customId,
      components: [
        { type: 18, component: { type: 3, custom_id: "kind", values: [f.kind ?? "pvp:zvz"] } },
        { type: 18, component: { type: 3, custom_id: "count", values: f.count ? [f.count] : [] } },
        ...(f.preset !== undefined ? [{ type: 18, component: { type: 3, custom_id: "preset", values: f.preset ? [f.preset] : [] } }] : []),
        { type: 18, component: { type: 4, custom_id: "tier", value: f.tier ?? "Weapon T7.1 - Gear T4.3" } },
        { type: 18, component: { type: 3, custom_id: "loot", values: [f.loot ?? "1"] } },
      ],
    },
    ...over,
  });
const embed = (r: any) => r.data.embeds[0];
const all = (r: any) => r.data.components.flatMap((row: any) => row.components);
const find = (r: any, prefix: string) => all(r).find((c: any) => c.custom_id.startsWith(prefix));
const refused = (r: any) => r.data.flags === 64 && r.data.content.includes("expired or are not yours");

// The first form -> the first slot card. The draft id is on the card's buttons.
async function begin(d: any, count: string | null = "5", f: First = {}) {
  const card: any = await d(firstForm({ ...f, ...(count ? { count } : {}) }));
  const id = card.data.components.at(-1).components.at(-1).custom_id.split(":")[2] as string;
  return { id, card };
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

test("the first form starts the slot cards and stores a draft with type, category, loot, count and gear tier", async () => {
  const { sql, d } = await setup();
  const { id, card } = await begin(d, "5", { kind: "pve:mists", loot: "1", tier: "  T8 flat  " });
  assert.equal(card.type, 4);
  assert.equal(card.data.flags, 64);
  const stored = (await getDraft(sql, id, NOW))!;
  assert.deepEqual([stored.type, stored.kind, stored.loot, stored.count, stored.gearTier, stored.userId], ["pve", "mists", true, 5, "T8 flat", "u1"]);
  const plainPvx = (await begin(d, "2", { kind: "pvx:other", loot: "0" })).id;
  const pvx = (await getDraft(sql, plainPvx, NOW))!;
  assert.deepEqual([pvx.type, pvx.kind, pvx.loot], ["pvx", "other", false]);
});

test("the first form refuses a forged category, an empty gear tier and an unknown build marker", async () => {
  const { d } = await setup();
  for (const [f, cid] of [[{ kind: "pvp:mists" }, "cf"], [{ kind: "zzz" }, "cf"], [{ tier: "   " }, "cf"], [{}, "cf:bnope"], [{}, "cf:a:b"]] as [First, string][]) {
    const r: any = await d(firstForm({ count: "3", ...f }, {}, cid));
    assert.equal(r.data.flags, 64, JSON.stringify(f) + cid);
    assert.ok(!r.data.embeds, "no card");
  }
});

test("a valid number shows slot card 1 with three lists with placeholders, then the buttons", async () => {
  const { d } = await setup();
  const { id, card } = await begin(d, "5");
  assert.equal(card.type, 4);
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

test("without a number the first card asks for one; bad numbers are refused privately and change nothing", async () => {
  const { sql, d } = await setup();
  const { id, card } = await begin(d, null);
  assert.ok(embed(card).description.includes("Press **Set number**"));
  const modal: any = await d(press(`gs:count:${id}`));
  assert.equal(modal.type, 9);
  for (const [text, reason] of [["0", "At least 1"], ["21", "maximum is 20"], ["abc", "whole number"], ["", "whole number"], ["2.5", "whole number"], ["-1", "whole number"]]) {
    const r: any = await d(form(`gsc:${id}`, { count: text! }));
    assert.equal(r.data.flags, 64);
    assert.ok(r.data.content.includes(reason!), `${text}: ${r.data.content}`);
  }
  assert.equal((await getDraft(sql, id, NOW))!.count, null);
  assert.ok(embed(await d(form(`gsc:${id}`, { count: "3" }))).description.includes("Slot 1 of 3"));
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
  assert.deepEqual(r.data.components[0].components.map((b: any) => b.label), ["Continue to form", "Back", "Change number", "Cancel"]);
});

test("Back on the first card reopens the first form with the choices kept", async () => {
  const { d } = await setup();
  const { id } = await begin(d, "3", { kind: "pve:world-boss", loot: "1", tier: "T7" });
  const r: any = await d(press(`gs:back:${id}`));
  assert.equal(r.type, 9);
  assert.equal(r.data.custom_id, "cf");
  const field = (cid: string) => r.data.components.map((l: any) => l.component).find((c: any) => c.custom_id === cid);
  assert.deepEqual(field("kind").options.filter((o: any) => o.default).map((o: any) => o.value), ["pve:world-boss"]);
  assert.deepEqual(field("count").options.filter((o: any) => o.default).map((o: any) => o.value), ["3"]);
  assert.equal(field("tier").value, "T7");
  assert.deepEqual(field("loot").options.filter((o: any) => o.default).map((o: any) => o.value), ["1"]);
});

test("Change number reopens the count form with the current value; a new number trims or extends", async () => {
  const { sql, d } = await setup();
  const { id } = await begin(d, "4");
  await fillCard(d, id, "Tank", "Mace");
  const f: any = await d(press(`gs:count:${id}`));
  assert.equal(f.data.components[0].components[0].value, "4");
  const r: any = await d(form(`gsc:${id}`, { count: "6" }));
  assert.ok(embed(r).description.includes("Slot 2 of 6"));
  assert.equal((await getDraft(sql, id, NOW))!.slots.length, 1);
});

test("the whole flow ends in the final form with duties in brackets and the gear tier, and the content is created", async () => {
  const { deps, d } = await setup();
  const { id } = await begin(d, "2", { tier: "Weapon T8 - Gear T6" });
  await fillCard(d, id, "Tank", "Greataxe", "caller");
  const done: any = await fillCard(d, id, "Healer", "Holy Staff");
  assert.ok(embed(done).description.includes("All 2 slots are chosen."));
  const f: any = await d(press(`gs:done:${id}`));
  assert.equal(f.type, 9);
  assert.equal(f.data.custom_id, "create:pvp:1:zvz");
  const inputs = f.data.components.map((row: any) => row.components[0]);
  assert.equal(inputs.find((c: any) => c.custom_id === "tier").value, "Weapon T8 - Gear T6", "the gear tier from the first form");
  const lines = inputs.find((c: any) => c.custom_id === "slots").value;
  assert.equal(lines, "Tank - Greataxe (Caller)\nHealer - Holy Staff");
  const submit = form("create:pvp:1:zvz", { title: "Raid", start: "2026-10-07 18:00", tier: "T6.0", slots: lines });
  assert.equal(((await handleCreateModal(deps, submit)) as any).data.content, "Created");
  const [{ duty }] = await (await testSql())`select duty from slot where position = 1`;
  assert.equal(duty, "caller");
});

test("Cancel on a card discards the draft; a create panel from an earlier version says to start again", async () => {
  const { sql, d } = await setup();
  const { id } = await begin(d, "3");
  const gone: any = await d(press(`gs:cancel:${id}`));
  assert.equal(gone.data.content, "Creation cancelled.");
  assert.deepEqual(gone.data.components, []);
  assert.equal(await getDraft(sql, id, NOW), null);
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
  assert.ok(refused(await d(form(`gsc:${id}`, { count: "4" }, { member: { user: { id: "u2" }, roles: [] } }))));
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

test("the final form is refused while the post already has content, and so is the first form", async () => {
  const { sql, d } = await setup();
  const { id } = await begin(d, "1");
  await fillCard(d, id, "Tank", "Mace");
  await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvp", title: "x", notes: null, startsAt: new Date("2026-12-01T18:00:00Z"),
    tier: "T8.0", hasLoot: false, createdBy: "u3", slots: [{ role: "R", weapon: "W" }],
  });
  for (const r of [await d(press(`gs:done:${id}`)), await d(firstForm({ count: "2" }))] as any[]) {
    assert.equal(r.data.flags, 64);
    assert.ok(r.data.content.includes("already has content"), r.data.content);
  }
});

test("a preset in the first form loads its slots and offers the final form with them and the gear tier", async () => {
  const { sql, d } = await setup();
  const [{ id: presetId }] = await sql`insert into slot_preset (guild_id, name, slots, created_by) values ('g1', 'Ava', '[{"role":"Tank","weapon":"Mace"},{"role":"Healer","weapon":""}]'::jsonb, 'o') returning id`;
  const r: any = await d(firstForm({ count: "9", preset: presetId, tier: "T8" }));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.ok(r.data.content.includes("Ava") && r.data.content.includes("2 positions"));
  const open = r.data.components[0].components[0];
  assert.equal(open.label, "Open form");
  const f: any = await d(press(open.custom_id));
  assert.equal(f.type, 9);
  const inputs = f.data.components.map((row: any) => row.components[0]);
  assert.equal(inputs.find((c: any) => c.custom_id === "slots").value, "Tank - Mace\nHealer");
  assert.equal(inputs.find((c: any) => c.custom_id === "tier").value, "T8");
  assert.ok(((await d(firstForm({ preset: "00000000-0000-0000-0000-000000000000" }))) as any).data.content.includes("no longer exists"));
});

import { discordProblems, modalProblems } from "../helpers/discordLimits.ts";

test("every private message in the create and guided flow stays inside Discord's limits", async () => {
  const { sql, d } = await setup();
  await sql`insert into slot_preset (guild_id, name, slots, created_by) select 'g1', 'P' || n, '[{"role":"Tank","weapon":"Mace"}]'::jsonb, 'o' from generate_series(1, 25) n`;
  const seen: any[] = [];
  const run = async (i: Interaction) => { const r: any = await d(i); if (r.data?.components || r.data?.embeds) seen.push(r.data); return r; };
  const opened: any = await d(base({ type: 2, data: { name: "content", options: [{ name: "create", type: 1 }] } }));
  assert.equal(opened.type, 9, "the first form opens directly");
  assert.deepEqual(modalProblems(opened.data), []);
  assert.equal(opened.data.components.length, 5, "type and category, players, preset, gear tier, loot");
  assert.ok(opened.data.components.find((l: any) => l.component.custom_id === "preset").component.options.length <= 25);
  const card: any = await run(firstForm({ count: "20" }));
  const id = card.data.components.at(-1).components.at(-1).custom_id.split(":")[2];
  await run(press(`gs:class:${id}`, ["Axe"]));
  await run(press(`gs:role:${id}`, ["Tank"]));
  await run(press(`gs:duty:${id}`, ["caller"]));
  const weapons: any = await run(press(`gs:class:${id}`, ["Bow"]));
  const firstWeapon = weapons.data.components.flatMap((r: any) => r.components).find((c: any) => c.custom_id.startsWith("gs:weapon")).options[0].value;
  await run(press(`gs:weapon:${id}`, [firstWeapon]));
  await run(press(`gs:next:${id}`));
  await run(press(`gs:same:${id}`));
  await run(press(`gs:rest:${id}`));
  const back: any = await d(press(`gs:back:${id}`));
  assert.ok(embed(back).description.includes("Slot"), "Back from the last card goes to the card before");
  const first: any = await d(firstForm({ count: "2" }));
  const firstId = first.data.components.at(-1).components.at(-1).custom_id.split(":")[2];
  assert.deepEqual(modalProblems(((await d(press(`gs:back:${firstId}`))) as any).data), [], "the reopened first form");
  assert.ok(seen.length >= 8);
  const problems = seen.flatMap((data, n) => discordProblems(data).map((p) => `message ${n}: ${p}`));
  assert.deepEqual(problems, []);
});
