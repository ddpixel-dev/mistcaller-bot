import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMessageLink, forwardBody } from "../../src/domain/ctamsg.ts";

const G = "111";

test("parseMessageLink accepts the Discord hosts, spaces and angle brackets", () => {
  for (const host of ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]) {
    const r = parseMessageLink(`https://${host}/channels/${G}/222/333`, G);
    assert.deepEqual(r, { ok: true, value: { channelId: "222", messageId: "333" } });
  }
  assert.deepEqual(parseMessageLink(`  <https://discord.com/channels/${G}/222/333>  `, G), {
    ok: true,
    value: { channelId: "222", messageId: "333" },
  });
});

test("parseMessageLink rejects bad input with a message", () => {
  for (const s of [
    "https://discord.com/channels/999/222/333",
    "https://discord.com/channels/@me/222/333",
    `https://discord.com/channels/${G}/222`,
    `https://discord.com/channels/${G}/abc/333`,
    "not a url",
    "",
  ]) {
    const r = parseMessageLink(s, G);
    assert.equal(r.ok, false, s);
    assert.ok(!r.ok && r.error.length > 0);
  }
});
test("forwardBody is a forward reference with no content and no embeds, and blocks all mentions", () => {
  const b = forwardBody({ guildId: "g1", channelId: "c1", messageId: "m1" });
  assert.deepEqual(b, {
    message_reference: { type: 1, guild_id: "g1", channel_id: "c1", message_id: "m1", fail_if_not_exists: true },
    allowed_mentions: { parse: [] },
  });
  assert.ok(!("content" in b) && !("embeds" in b));
});
