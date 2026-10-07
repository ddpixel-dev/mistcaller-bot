import { test } from "node:test";
import assert from "node:assert/strict";
import { handleWeaponCommand } from "../../src/handlers/weapon.ts";
import { handleAutocomplete } from "../../src/handlers/preset.ts";
import type { Deps } from "../../src/discord/dispatch.ts";
import type { Interaction } from "../../src/discord/types.ts";

const deps = {} as Deps;
const cmd = (name: unknown, type = 2, focused = false): Interaction => ({
  id: "i", type, application_id: "a", token: "t", guild_id: "g1", member: { user: { id: "u" }, roles: [] },
  data: { name: "content", options: [{ name: "weapon", type: 1, options: [{ name: "name", type: 3, value: name, ...(focused ? { focused: true } : {}) }] }] },
});

test("a match shows an ephemeral embed with the name, class and a linked icon", async () => {
  const r: any = await handleWeaponCommand(deps, cmd("broadsword"));
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  const e = r.data.embeds[0];
  assert.equal(e.title, "Broadsword");
  assert.match(e.thumbnail.url, /^https:\/\/render\.albiononline\.com\/v1\/item\/T\d_MAIN_SWORD\.png\?size=128$/);
  assert.ok(e.description.includes("One-handed"));
  assert.ok(e.description.includes("`Role - Broadsword`"));
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
});

test("a broad search lists the other matches; no match and empty input are explained", async () => {
  const r: any = await handleWeaponCommand(deps, cmd("staff"));
  assert.ok(r.data.embeds[0].description.includes("Also matching:"));
  assert.ok(((await handleWeaponCommand(deps, cmd("zzzzqq"))) as any).data.content.includes("No weapon matches"));
  assert.ok(((await handleWeaponCommand(deps, cmd("@everyone zzqq"))) as any).data.content.includes("@​everyone"));
  assert.ok(((await handleWeaponCommand(deps, cmd("  "))) as any).data.content.includes("Type part"));
  assert.ok(((await handleWeaponCommand(deps, cmd(5))) as any).data.content.includes("Type part"));
});

test("weapon autocomplete returns up to 25 names as type 8", async () => {
  const r: any = await handleAutocomplete(deps, cmd("axe", 4, true));
  assert.equal(r.type, 8);
  assert.ok(r.data.choices.length > 0 && r.data.choices.length <= 25);
  assert.ok(r.data.choices.every((c: any) => c.name === c.value && c.name.toLowerCase().includes("axe")));
  const none: any = await handleAutocomplete(deps, cmd("", 4, true));
  assert.deepEqual(none.data.choices, []);
});
