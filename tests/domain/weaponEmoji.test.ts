import { test } from "node:test";
import assert from "node:assert/strict";
import { emojiFor, emojiName, emojiTag, weaponsToUpload } from "../../src/domain/weaponEmoji.ts";
import { WEAPONS } from "../../src/data/weapons.ts";
import { WEAPON_EMOJI } from "../../src/data/weapon-emoji.ts";
import { weaponEmojiByName, weaponEmojiTag } from "../../src/render/weaponIcon.ts";

test("every weapon gets a valid, unique Discord emoji name", () => {
  const names = WEAPONS.map((w) => emojiName(w.base));
  for (const n of names) assert.match(n, /^[A-Za-z0-9_]{2,32}$/, n);
  assert.equal(new Set(names).size, names.length);
  assert.equal(emojiName("2H_AXE"), "w_2H_AXE");
  assert.equal(emojiName("x".repeat(60)).length, 32);
});

test("only the weapons the app does not own yet are uploaded", () => {
  const owned = new Set([emojiName(WEAPONS[0]!.base), emojiName(WEAPONS[1]!.base)]);
  const todo = weaponsToUpload(WEAPONS, owned);
  assert.equal(todo.length, WEAPONS.length - 2);
  assert.ok(!todo.some((w) => owned.has(emojiName(w.base))));
  assert.equal(weaponsToUpload(WEAPONS, new Set(WEAPONS.map((w) => emojiName(w.base)))).length, 0);
});

test("an emoji reference needs a real id; the tag is the inline form", () => {
  const map = { MAIN_SWORD: "1234567890123456789", BAD: "abc", SHORT: "12" };
  assert.deepEqual(emojiFor(map, "MAIN_SWORD"), { id: "1234567890123456789", name: "w_MAIN_SWORD" });
  assert.equal(emojiFor(map, "BAD"), undefined);
  assert.equal(emojiFor(map, "SHORT"), undefined);
  assert.equal(emojiFor(map, "NOPE"), undefined);
  assert.equal(emojiTag({ id: "1234567890123456789", name: "w_MAIN_SWORD" }), "<:w_MAIN_SWORD:1234567890123456789>");
  assert.equal(emojiTag(undefined), "");
});

test("a weapon is found by its display name, case-insensitively; unknown names have no icon", () => {
  const sword = WEAPONS.find((w) => w.name === "Broadsword")!;
  const map = { [sword.base]: "1234567890123456789" };
  assert.equal(weaponEmojiByName("broadsword", map)?.name, `w_${sword.base}`);
  assert.equal(weaponEmojiTag("  Broadsword ", map), `<:w_${sword.base}:1234567890123456789>`);
  assert.equal(weaponEmojiTag("Some New Weapon", map), "");
  assert.equal(weaponEmojiTag("Greataxe", {}), "");
});

test("the generated map only holds known weapons with plausible ids", () => {
  for (const [base, id] of Object.entries(WEAPON_EMOJI)) {
    assert.ok(WEAPONS.some((w) => w.base === base), base);
    assert.match(id, /^\d{15,25}$/);
  }
});
