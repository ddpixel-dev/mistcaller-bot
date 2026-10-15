import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRefText, packRef, parseBuildReference, unpackRef } from "../../src/domain/buildref.ts";

const G = "100000000000000001", C = "123456789012345678", M = "223456789012345678";

test("a link to a channel, thread or forum post of this server becomes a channel reference", () => {
  for (const host of ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]) {
    assert.deepEqual(parseBuildReference(`https://${host}/channels/${G}/${C}`, G), { ok: true, value: C });
  }
  assert.deepEqual(parseBuildReference(`  <https://discord.com/channels/${G}/${C}/>  `, G), { ok: true, value: C });
});

test("a link to a message becomes channel/message", () => {
  assert.deepEqual(parseBuildReference(`https://discord.com/channels/${G}/${C}/${M}`, G), { ok: true, value: `${C}/${M}` });
});

test("links of another server, other sites, direct messages and garbage are refused with a reason", () => {
  for (const text of [
    `https://discord.com/channels/999999999999999999/${C}`, "https://example.com/build", `https://discord.com/channels/@me/${C}`,
    "not a link", "", `https://discord.com/channels/${G}`, `https://discord.com/channels/${G}/${C}/${M}/extra`, `javascript:alert(1)`,
  ]) {
    const r = parseBuildReference(text, G);
    assert.equal(r.ok, false, text);
    assert.ok(!r.ok && r.error.length > 10);
  }
});

test("the roster shows a channel as a mention and a message as a link", () => {
  assert.equal(buildRefText(C, G), `<#${C}>`);
  assert.equal(buildRefText(`${C}/${M}`, G), `[Build message](https://discord.com/channels/${G}/${C}/${M})`);
});

test("references pack into short ids that fit Discord's 100 characters, and unpack again; old plain ids still work", () => {
  for (const ref of [C, `${C}/${M}`, `${"9".repeat(20)}/${"9".repeat(20)}`]) {
    const packed = packRef(ref);
    assert.ok(packed.length <= 28, `${packed.length}`);
    assert.equal(unpackRef(packed), ref);
  }
  assert.equal(unpackRef(C), C, "a panel made before this release carries the plain channel id");
  for (const bad of ["", "r", "rZZ!", "r1.2.3", "abc", "r" + "z".repeat(40)]) assert.equal(unpackRef(bad), null, bad);
});
