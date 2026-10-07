import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent } from "../../src/db/content.ts";
import { getDraft } from "../../src/db/draft.ts";
import { handleCreateCommand, handleCreateModal } from "../../src/handlers/create.ts";
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
const search = (id: string, text: string, over: Partial<Interaction> = {}) =>
  base({ type: 5, data: { custom_id: `gsq:${id}`, components: [{ type: 1, components: [{ type: 4, custom_id: "weapon", value: text }] }] }, ...over });
const embed = (r: any) => r.data.embeds[0];
const ids = (r: any) => r.data.components.flatMap((row: any) => row.components.map((c: any) => c.custom_id));

async function start(d: any, suffix = "1:zvz:-") {
  const r: any = await d(press(`cpgs:${suffix}`));
  const id = ids(r)[0].split(":")[2] as string;
  return { r, id };
}

test("the create panel offers Guided slots next to Continue", async () => {
  const { deps } = await setup();
  const r: any = await handleCreateCommand(deps, base({ type: 2, data: { name: "content", options: [{ name: "create", type: 1 }] } }));
  const last = r.data.components[r.data.components.length - 1].components;
  assert.deepEqual(last.map((c: any) => c.custom_id), ["cpgo:0:other:-", "cpgs:0:other:-"]);
});

test("starting shows the member count step and stores a draft with loot and kind", async () => {
  const { sql, deps, d } = await setup();
  const { r, id } = await start(d);
  assert.equal(r.type, 7);
  assert.equal(embed(r).title, "Guided slots");
  assert.deepEqual(r.data.components[0].components[0].options.length, 20);
  const stored = (await getDraft(sql, id, NOW))!;
  assert.deepEqual([stored.loot, stored.kind, stored.count, stored.userId], [true, "zvz", null, "u1"]);
});

test("the whole flow: count, role, weapon search, pick, same as previous, fill the rest, then the form", async () => {
  const { deps, d } = await setup();
  const { id } = await start(d);
  let r: any = await d(press(`gs:count:${id}`, ["4"]));
  assert.ok(embed(r).description.includes("Slot 1 of 4"));
  r = await d(press(`gs:role:${id}`, ["Tank"]));
  assert.ok(embed(r).description.includes("Role: Tank"));
  const find: any = await d(press(`gs:find:${id}`));
  assert.equal(find.type, 9);
  assert.equal(find.data.custom_id, `gsq:${id}`);
  r = await d(search(id, "great axe"));
  assert.equal(r.type, 7);
  const pickRow = r.data.components.find((row: any) => row.components[0].custom_id === `gs:pick:${id}`);
  assert.ok(pickRow.components[0].options.length > 0);
  assert.match(embed(r).thumbnail.url, /render\.albiononline\.com\/v1\/item\/T\d_.*\.png\?size=128/);
  const base = pickRow.components[0].options[0].value;
  r = await d(press(`gs:pick:${id}`, [base]));
  assert.ok(embed(r).description.includes("1. Tank - "));
  assert.ok(embed(r).description.includes("Slot 2 of 4"));
  r = await d(press(`gs:same:${id}`));
  assert.ok(embed(r).description.includes("Slot 3 of 4"));
  r = await d(press(`gs:rest:${id}`));
  assert.ok(embed(r).description.includes("All 4 slots are chosen."));
  assert.ok(ids(r).includes(`gs:done:${id}`));
  const form: any = await d(press(`gs:done:${id}`));
  assert.equal(form.type, 9);
  assert.equal(form.data.custom_id, "create:1:zvz");
  const slots = form.data.components.map((row: any) => row.components[0]).find((c: any) => c.custom_id === "slots");
  assert.equal(slots.value.split("\n").length, 4);
  assert.ok(slots.value.startsWith("Tank - "));
  assert.equal(await handleCreateModal(deps, {
    ...base_modal(slots.value),
  }).then((x: any) => x.data.content), "Created");
  void deps;
});

function base_modal(slots: string): Interaction {
  return base({
    type: 5,
    data: {
      custom_id: "create:1:zvz",
      components: Object.entries({ title: "Raid", start: "2026-10-07 18:00", tier: "T6.0", slots }).map(([custom_id, value]) => ({
        type: 1, components: [{ type: 4, custom_id, value }],
      })),
    },
  });
}

test("weapon without a match can be used as typed; a role before the weapon also completes the slot", async () => {
  const { sql, d } = await setup();
  const { id } = await start(d);
  await d(press(`gs:count:${id}`, ["2"]));
  let r: any = await d(search(id, "zzzqqq"));
  assert.ok(embed(r).description.includes("No weapon matches"));
  assert.ok(ids(r).includes(`gs:typed:${id}`));
  r = await d(press(`gs:typed:${id}`));
  assert.ok(embed(r).description.includes("Weapon: zzzqqq"));
  assert.equal((await getDraft(sql, id, NOW))!.query, null);
  r = await d(press(`gs:role:${id}`, ["Healer"]));
  assert.ok(embed(r).description.includes("1. Healer - zzzqqq"));
});

test("Back removes the half-chosen slot first and then the last finished one; Same and Fill start disabled", async () => {
  const { sql, d } = await setup();
  const { id } = await start(d);
  let r: any = await d(press(`gs:count:${id}`, ["3"]));
  const disabled = (res: any, cid: string) => res.data.components.flatMap((row: any) => row.components).find((c: any) => c.custom_id === cid).disabled;
  assert.equal(disabled(r, `gs:same:${id}`), true);
  assert.equal(disabled(r, `gs:rest:${id}`), true);
  await d(press(`gs:role:${id}`, ["Tank"]));
  await d(search(id, "mace"));
  await d(press(`gs:typed:${id}`));
  r = await d(press(`gs:role:${id}`, ["Healer"]));
  assert.equal((await getDraft(sql, id, NOW))!.slots.length, 1);
  r = await d(press(`gs:back:${id}`));
  assert.equal((await getDraft(sql, id, NOW))!.role, null);
  assert.equal((await getDraft(sql, id, NOW))!.slots.length, 1);
  await d(press(`gs:back:${id}`));
  assert.equal((await getDraft(sql, id, NOW))!.slots.length, 0);
});

test("cancel deletes the draft; only its owner in its post can use it; expired drafts are refused", async () => {
  const { sql, d } = await setup();
  const { id } = await start(d);
  const refused = (r: any) => r.data.flags === 64 && r.data.content.includes("expired or are not yours");
  assert.ok(refused(await d(press(`gs:count:${id}`, ["3"], { member: { user: { id: "u2" }, roles: [] } }))));
  assert.ok(refused(await d(press(`gs:count:${id}`, ["3"], { guild_id: "g2" }))));
  assert.ok(refused(await d(press(`gs:count:${id}`, ["3"], { channel: { id: "other", type: 11, parent_id: "fp" } }))));
  assert.ok(refused(await d(search(id, "axe", { member: { user: { id: "u2" }, roles: [] } }))));
  await sql`update slot_draft set created_at = ${new Date(NOW.getTime() - 2 * 3600000)}`;
  assert.ok(refused(await d(press(`gs:count:${id}`, ["3"]))));
  const fresh = (await start(d)).id;
  const gone: any = await d(press(`gs:cancel:${fresh}`));
  assert.equal(gone.data.content, "Guided slots cancelled.");
  assert.equal(await getDraft(sql, fresh, NOW), null);
});

test("tampered ids and values are refused and change nothing", async () => {
  const { sql, d } = await setup();
  const { id } = await start(d);
  const refused = (r: any) => r.data.flags === 64;
  for (const cid of ["gs:count:nope", "gs:count", `gs:zzz:${id}`, `gs:count:${id}:x`, "gs::"]) {
    assert.ok(refused(await d(press(cid, ["3"]))), cid);
  }
  assert.ok(refused(await d(press(`gs:pick:${id}`, ["NOT_A_WEAPON"]))));
  await d(press(`gs:count:${id}`, ["99"]));
  await d(press(`gs:count:${id}`, ["abc"]));
  assert.equal((await getDraft(sql, id, NOW))!.count, null);
  await d(press(`gs:role:${id}`, ["Wizard"]));
  assert.equal((await getDraft(sql, id, NOW))!.role, null);
  assert.ok(refused(await d(press("cpgs:9:other:-"))));
});

test("Continue to form is refused while the post already has content", async () => {
  const { sql, d } = await setup();
  const { id } = await start(d);
  await d(press(`gs:count:${id}`, ["1"]));
  await d(press(`gs:role:${id}`, ["Tank"]));
  await d(search(id, "mace"));
  await d(press(`gs:typed:${id}`));
  await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvp", title: "x", notes: null, startsAt: new Date("2026-12-01T18:00:00Z"),
    tier: { min: { tier: 8, enchant: 0 }, max: null }, hasLoot: false, createdBy: "u3", slots: [{ role: "R", weapon: "W" }],
  });
  const r: any = await d(press(`gs:done:${id}`));
  assert.equal(r.data.flags, 64);
  assert.ok(r.data.content.includes("already has content"));
  const again: any = await d(press("cpgs:0:other:-"));
  assert.ok(again.data.content.includes("already has content"));
});
