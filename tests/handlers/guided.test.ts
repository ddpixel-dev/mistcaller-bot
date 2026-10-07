import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent } from "../../src/db/content.ts";
import { getDraft } from "../../src/db/draft.ts";
import { handleCreateModal } from "../../src/handlers/create.ts";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Rest } from "../../src/discord/rest.ts";
import type { Interaction } from "../../src/discord/types.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const rest: Rest = { async createMessage() { return { id: "m1" }; }, async editMessage() {}, async deleteMessage() {} };
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function setup() {
  const sql = await testSql();
  await sql`insert into guild_settings (guild_id, pvp_forum_id, pve_forum_id) values ('g1', 'fp', 'fe')`;
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
const roles = (id: string, t: string, h: string, s: string, dps: string, over: Partial<Interaction> = {}) =>
  form(`gsr:${id}`, { r0: t, r1: h, r2: s, r3: dps }, over);
const search = (id: string, text: string, over: Partial<Interaction> = {}) => form(`gsq:${id}`, { weapon: text }, over);
const slotCmd = (weapon: unknown, over: Partial<Interaction> = {}) =>
  base({ type: 2, data: { name: "content", options: [{ name: "slot", type: 1, options: [{ name: "weapon", type: 3, value: weapon }] }] }, ...over });
const embed = (r: any) => r.data.embeds[0];
const ids = (r: any) => r.data.components.flatMap((row: any) => row.components.map((c: any) => c.custom_id));
const refused = (r: any) => r.data.flags === 64 && r.data.content.includes("expired or are not yours");

async function start(d: any, suffix = "pvp:1:zvz:-") {
  const r: any = await d(press(`cpgs:${suffix}`));
  const id = ids(r)[0].split(":")[2] as string;
  return { r, id };
}

test("Continue without a preset offers a form or guided steps; the first panel has no guided button", async () => {
  const { d } = await setup();
  const cmd: any = await d(base({ type: 2, data: { name: "content", options: [{ name: "create", type: 1 }] } }));
  const last = cmd.data.components[cmd.data.components.length - 1].components;
  assert.deepEqual(last.map((c: any) => c.custom_id), ["cpgo:-:-:-:-"]);
  const choice: any = await d(press("cpgo:pvp:1:zvz:-"));
  assert.equal(choice.type, 7);
  assert.ok(choice.data.content.includes("How do you want to set the slots?"));
  assert.deepEqual(ids(choice), ["cpform:pvp:1:zvz:-", "cpgs:pvp:1:zvz:-"]);
  const plain: any = await d(press("cpform:pvp:1:zvz:-"));
  assert.equal(plain.type, 9);
  assert.equal(plain.data.custom_id, "create:pvp:1:zvz");
  assert.equal(plain.data.components.map((row: any) => row.components[0]).find((c: any) => c.custom_id === "slots").value, undefined);
});

test("starting guided steps asks for the role numbers and stores a draft with loot and kind", async () => {
  const { sql, d } = await setup();
  const { r, id } = await start(d);
  assert.equal(r.type, 7);
  assert.ok(embed(r).description.includes("Set roles"));
  assert.deepEqual(ids(r), [`gs:roles:${id}`, `gs:cancel:${id}`]);
  const stored = (await getDraft(sql, id, NOW))!;
  assert.deepEqual([stored.loot, stored.kind, stored.counts, stored.userId], [true, "zvz", null, "u1"]);
});

test("Set roles opens a form with four number boxes; valid numbers set the slots in order", async () => {
  const { d } = await setup();
  const { id } = await start(d);
  const f: any = await d(press(`gs:roles:${id}`));
  assert.equal(f.type, 9);
  assert.equal(f.data.custom_id, `gsr:${id}`);
  const inputs = f.data.components.map((row: any) => row.components[0]);
  assert.deepEqual(inputs.map((x: any) => [x.custom_id, x.label, x.required]), [["r0", "Tank", false], ["r1", "Healer", false], ["r2", "Support", false], ["r3", "DPS", false]]);
  const r: any = await d(roles(id, "1", "1", "", "2"));
  assert.equal(r.type, 7);
  assert.ok(embed(r).description.includes("1 Tank · 1 Healer · 0 Support · 2 DPS"));
  assert.ok(embed(r).description.includes("Slot 1 of 4 · Tank"));
  const again: any = await d(press(`gs:roles:${id}`));
  assert.deepEqual(again.data.components.map((row: any) => row.components[0].value), ["1", "1", "0", "2"]);
});

test("bad numbers are refused privately and change nothing", async () => {
  const { sql, d } = await setup();
  const { id } = await start(d);
  for (const [t, h, s, dps, text] of [["a", "", "", "", "whole number"], ["", "", "", "", "at least one"], ["10", "10", "1", "", "21 members"], ["-1", "", "", "", "whole number"]]) {
    const r: any = await d(roles(id, t!, h!, s!, dps!));
    assert.equal(r.data.flags, 64);
    assert.ok(r.data.content.includes(text!), r.data.content);
  }
  assert.equal((await getDraft(sql, id, NOW))!.counts, null);
});

test("the whole flow: numbers, weapon search and pick, same as previous, fill the rest, then the form and the content", async () => {
  const { deps, d } = await setup();
  const { id } = await start(d);
  await d(roles(id, "2", "1", "0", "2"));
  const find: any = await d(press(`gs:find:${id}`));
  assert.equal(find.type, 9);
  assert.equal(find.data.custom_id, `gsq:${id}`);
  let r: any = await d(search(id, "great axe"));
  const pickRow = r.data.components.find((row: any) => row.components[0].custom_id === `gs:pick:${id}`);
  assert.ok(pickRow.components[0].options.length > 0);
  assert.match(embed(r).thumbnail.url, /render\.albiononline\.com\/v1\/item\/T\d_.*\.png\?size=128/);
  r = await d(press(`gs:pick:${id}`, [pickRow.components[0].options[0].value]));
  assert.ok(embed(r).description.includes("1. Tank - "));
  assert.ok(embed(r).description.includes("Slot 2 of 5 · Tank"));
  r = await d(press(`gs:same:${id}`));
  assert.ok(embed(r).description.includes("Slot 3 of 5 · Healer"));
  r = await d(press(`gs:rest:${id}`));
  assert.ok(embed(r).description.includes("All slots are chosen."));
  assert.ok(ids(r).includes(`gs:done:${id}`));
  const f: any = await d(press(`gs:done:${id}`));
  assert.equal(f.type, 9);
  assert.equal(f.data.custom_id, "create:pvp:1:zvz");
  const lines = f.data.components.map((row: any) => row.components[0]).find((c: any) => c.custom_id === "slots").value.split("\n");
  assert.deepEqual(lines.map((l: string) => l.split(" - ")[0]), ["Tank", "Tank", "Healer", "DPS", "DPS"]);
  const submit = form("create:pvp:1:zvz", { title: "Raid", start: "2026-10-07 18:00", tier: "T6.0", slots: lines.join("\n") });
  assert.equal(((await handleCreateModal(deps, submit)) as any).data.content, "Created");
});

test("a weapon with no match can be used as typed", async () => {
  const { sql, d } = await setup();
  const { id } = await start(d);
  await d(roles(id, "0", "0", "0", "2"));
  let r: any = await d(search(id, "zzzqqq"));
  assert.ok(embed(r).description.includes("No weapon matches"));
  assert.ok(ids(r).includes(`gs:typed:${id}`));
  r = await d(press(`gs:typed:${id}`));
  assert.ok(embed(r).description.includes("1. DPS - zzzqqq"));
  assert.equal((await getDraft(sql, id, NOW))!.query, null);
});

test("/content slot adds the weapon with a searchable list, replying with a fresh private card", async () => {
  const { sql, d } = await setup();
  assert.ok((await d(slotCmd("mace")) as any).data.content.includes("Start the guided steps first"));
  const { id } = await start(d);
  assert.ok((await d(slotCmd("mace")) as any).data.content.includes("Set the roles first"));
  await d(roles(id, "1", "1", "0", "1"));
  const r: any = await d(slotCmd("broadsword"));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.ok(embed(r).description.includes("1. Tank - Broadsword"));
  const typed: any = await d(slotCmd("Some New Weapon"));
  assert.ok(embed(typed).description.includes("2. Healer - Some New Weapon"));
  assert.ok((await d(slotCmd("   ")) as any).data.content.includes("Type part"));
  assert.ok((await d(slotCmd("x".repeat(41))) as any).data.content.includes("too long"));
  await d(slotCmd("Bow"));
  assert.ok((await d(slotCmd("Bow")) as any).data.content.includes("All slots are chosen"));
  assert.equal((await getDraft(sql, id, NOW))!.slots.length, 3);
  assert.ok((await d(slotCmd("Bow", { member: { user: { id: "u2" }, roles: [] } })) as any).data.content.includes("Start the guided steps first"));
});

test("Back removes the last slot; changing the numbers starts the slots over", async () => {
  const { sql, d } = await setup();
  const { id } = await start(d);
  await d(roles(id, "1", "0", "0", "2"));
  const disabled = (res: any, cid: string) => res.data.components.flatMap((row: any) => row.components).find((c: any) => c.custom_id === cid).disabled;
  const first: any = await d(press(`gs:back:${id}`));
  assert.equal(disabled(first, `gs:same:${id}`), true);
  assert.equal(disabled(first, `gs:rest:${id}`), true);
  await d(slotCmd("Mace"));
  await d(slotCmd("Bow"));
  assert.equal((await getDraft(sql, id, NOW))!.slots.length, 2);
  await d(press(`gs:back:${id}`));
  assert.deepEqual((await getDraft(sql, id, NOW))!.slots, [{ role: "Tank", weapon: "Mace" }]);
  await d(roles(id, "1", "0", "0", "2"));
  assert.equal((await getDraft(sql, id, NOW))!.slots.length, 1);
  await d(roles(id, "2", "0", "0", "2"));
  assert.deepEqual((await getDraft(sql, id, NOW))!.slots, []);
});

test("cancel deletes the draft; only its owner in its post can use it; expired drafts are refused", async () => {
  const { sql, d } = await setup();
  const { id } = await start(d);
  assert.ok(refused(await d(press(`gs:roles:${id}`, undefined, { member: { user: { id: "u2" }, roles: [] } }))));
  assert.ok(refused(await d(press(`gs:roles:${id}`, undefined, { guild_id: "g2" }))));
  assert.ok(refused(await d(press(`gs:roles:${id}`, undefined, { channel: { id: "other", type: 11, parent_id: "fp" } }))));
  assert.ok(refused(await d(roles(id, "1", "", "", "", { member: { user: { id: "u2" }, roles: [] } }))));
  assert.ok(refused(await d(search(id, "axe", { member: { user: { id: "u2" }, roles: [] } }))));
  await sql`update slot_draft set created_at = ${new Date(NOW.getTime() - 2 * 3600000)}`;
  assert.ok(refused(await d(press(`gs:roles:${id}`))));
  const fresh = (await start(d)).id;
  const gone: any = await d(press(`gs:cancel:${fresh}`));
  assert.equal(gone.data.content, "Guided slots cancelled.");
  assert.equal(await getDraft(sql, fresh, NOW), null);
});

test("tampered ids and values are refused and change nothing", async () => {
  const { sql, d } = await setup();
  const { id } = await start(d);
  for (const cid of ["gs:roles:nope", "gs:roles", `gs:zzz:${id}`, `gs:roles:${id}:x`, "gs::"]) {
    assert.equal(((await d(press(cid))) as any).data.flags, 64, cid);
  }
  assert.equal(((await d(press(`gs:pick:${id}`, ["NOT_A_WEAPON"]))) as any).data.flags, 64);
  assert.equal(((await d(form(`gsr:${id}:x`, { r0: "1" }))) as any).data.flags, 64);
  assert.equal(((await d(press("cpgs:xx:9:other:-"))) as any).data.flags, 64);
  assert.equal((await getDraft(sql, id, NOW))!.counts, null);
});

test("Continue to form and the choice buttons are refused while the post already has content", async () => {
  const { sql, d } = await setup();
  const { id } = await start(d);
  await d(roles(id, "1", "0", "0", "0"));
  await d(slotCmd("Mace"));
  await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvp", title: "x", notes: null, startsAt: new Date("2026-12-01T18:00:00Z"),
    tier: { min: { tier: 8, enchant: 0 }, max: null }, hasLoot: false, createdBy: "u3", slots: [{ role: "R", weapon: "W" }],
  });
  for (const cid of [`gs:done:${id}`, "cpgs:pvp:0:other:-", "cpform:pvp:0:other:-", "cpgo:pvp:0:other:-"]) {
    const r: any = await d(press(cid));
    assert.equal(r.data.flags, 64, cid);
    assert.ok(r.data.content.includes("already has content"), cid);
  }
});
