import { test } from "node:test";
import assert from "node:assert/strict";
import { IS_COMPONENTS_V2, discordProblems, flatComponents, textOf } from "./discordLimits.ts";

const btn = (id: string, extra: object = {}) => ({ type: 2, style: 2, label: "x", custom_id: id, ...extra });
const row = (...c: object[]) => ({ type: 1, components: c });

test("a fine classic message has no problems", () => {
  assert.deepEqual(discordProblems({ embeds: [{ title: "t", description: "d" }], components: [row(btn("a"), btn("b"))] }), []);
});

test("catches the rules we have broken or nearly broken", () => {
  const p = (b: object) => discordProblems(b).join(" | ");
  assert.match(p({ components: [row(btn("a", { emoji: { name: "✚" } }))] }), /not a real emoji/);
  assert.match(p({ components: Array.from({ length: 6 }, (_, i) => row(btn(`b${i}`))) }), /more than 5 rows/);
  assert.match(p({ components: [row(...Array.from({ length: 6 }, (_, i) => btn(`b${i}`)))] }), /more than 5 components/);
  assert.match(p({ components: [row(btn("a"), btn("a"))] }), /duplicate custom_id/);
  assert.match(p({ components: [row({ type: 3, custom_id: "m", options: [] })] }), /1 to 25 options/);
  assert.match(p({ components: [row(btn("a", { label: "x".repeat(81) }))] }), /label over 80/);
  assert.match(p({ components: [row(btn("a".repeat(101)))] }), /custom_id over 100/);
  assert.match(p({ embeds: [{ description: "x".repeat(4097) }] }), /over 4096/);
  assert.match(p({ embeds: Array.from({ length: 11 }, () => ({ title: "t" })) }), /more than 10 embeds/);
  assert.match(p({ components: [row({ type: 3, custom_id: "m", options: [{ label: "a", value: "1" }, { label: "b", value: "1" }] })] }), /duplicate option values/);
  assert.deepEqual(discordProblems({ components: [row(btn("a", { emoji: { id: "123456789012345678", name: "w_MAIN_SWORD" } }), btn("b", { emoji: { name: "🛡️" } }))] }), []);
});

test("V2 messages: flag rules, the 40-component limit and sections", () => {
  const text = (content: string) => ({ type: 10, content });
  const section = (id: string) => ({ type: 9, components: [text("row")], accessory: btn(id) });
  const v2 = (...c: object[]) => ({ flags: IS_COMPONENTS_V2, components: c });
  assert.deepEqual(discordProblems(v2({ type: 17, accent_color: 0x2b4db0, components: [text("hi"), section("a")] })), []);
  assert.match(discordProblems({ ...v2(text("x")), content: "no" }).join(), /cannot have content/);
  assert.match(discordProblems({ ...v2(text("x")), embeds: [{ title: "t" }] }).join(), /cannot have embeds/);
  const many = v2({ type: 17, components: Array.from({ length: 14 }, (_, i) => section(`s${i}`)) });
  assert.match(discordProblems(many).join(), /43 components \(limit 40\)/);
  assert.deepEqual(discordProblems(v2({ type: 17, components: Array.from({ length: 12 }, (_, i) => section(`s${i}`)) })), []);
  assert.match(discordProblems(v2({ type: 9, components: [text("a")], accessory: undefined })).join(), /button or thumbnail/);
  assert.match(discordProblems(v2(text("x".repeat(4001)))).join(), /over 4000/);
  assert.match(discordProblems(v2(text(""))).join(), /empty text block/);
});

test("helpers read text and components out of nested messages", () => {
  const msg = { components: [{ type: 17, components: [{ type: 10, content: "A" }, { type: 9, components: [{ type: 10, content: "B" }], accessory: btn("z") }] }] };
  assert.equal(textOf(msg), "A\nB");
  assert.deepEqual(flatComponents(msg).filter((c) => c.type === 2).map((c) => c.custom_id), ["z"]);
});
