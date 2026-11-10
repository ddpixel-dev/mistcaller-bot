import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMessageLink, buildCtaCopy, CTA_COPY_LIMIT } from "../../src/domain/ctamsg.ts";

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

test("buildCtaCopy keeps text as typed and blocks all mentions", () => {
  const r = buildCtaCopy({ content: "Read <#123> and @everyone", embeds: [], attachments: [] });
  assert.ok(r);
  assert.equal(r.content, "Read <#123> and @everyone");
  assert.deepEqual(r.allowed_mentions, { parse: [] });
});

test("buildCtaCopy appends attachment urls and cuts at a line boundary", () => {
  const r = buildCtaCopy({ content: "hi", embeds: [], attachments: [{ url: "https://x/a.png" }, { url: "https://x/b.png" }] });
  assert.equal(r?.content, "hi\nhttps://x/a.png\nhttps://x/b.png");

  const line = "a".repeat(900);
  const long = buildCtaCopy({ content: `${line}\n${line}\n${line}`, embeds: [], attachments: [{ url: "https://x/c.png" }] });
  assert.ok(long?.content);
  assert.ok(long.content.length <= CTA_COPY_LIMIT);
  assert.equal(long.content, `${line}\n${line}`);

  const one = buildCtaCopy({ content: "b".repeat(3000), embeds: [], attachments: [] });
  assert.equal(one?.content, "b".repeat(1999) + "…");
});

test("buildCtaCopy keeps rich embeds and drops the rest", () => {
  const r = buildCtaCopy({
    content: "x",
    embeds: [{ type: "rich", title: "t" }, { type: "link" }, { type: "image" }, { type: "video" }, { type: "gifv" }],
    attachments: [],
  });
  assert.deepEqual(r?.embeds, [{ type: "rich", title: "t" }]);
  assert.equal(buildCtaCopy({ content: "x", embeds: [{ type: "link" }], attachments: [] })?.embeds, undefined);
});

test("buildCtaCopy returns null when there is nothing to copy", () => {
  assert.equal(buildCtaCopy({ content: "  ", embeds: [{ type: "image" }], attachments: [] }), null);
  assert.equal(buildCtaCopy({ content: "", embeds: [], attachments: [] }), null);
  assert.equal(buildCtaCopy({ content: "", embeds: [{ type: "rich" }], attachments: [], flags: 1 << 15 }), null);
});
