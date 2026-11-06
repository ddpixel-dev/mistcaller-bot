import { test } from "node:test";
import assert from "node:assert/strict";
import { splitChangelog, changelogFileName } from "../../src/domain/changelog.ts";

test("a short changelog is one message, trimmed", () => {
  assert.deepEqual(splitChangelog("\n# 0.29.0\n\nHello\n\n", 2000), ["# 0.29.0\n\nHello"]);
});

test("a long changelog splits between paragraphs, never past the limit, and loses nothing", () => {
  const paras = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${"x".repeat(100)}`);
  const parts = splitChangelog(paras.join("\n\n"), 500);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.length <= 500);
  assert.equal(parts.join("\n\n"), paras.join("\n\n"));
});

test("a paragraph longer than the limit is cut at line breaks, then hard, and still loses nothing", () => {
  const lines = Array.from({ length: 12 }, (_, i) => `- line ${i} ${"y".repeat(60)}`).join("\n");
  const parts = splitChangelog(lines, 200);
  for (const p of parts) assert.ok(p.length <= 200);
  assert.equal(parts.join("\n"), lines);
  const blob = "z".repeat(450);
  const cut = splitChangelog(blob, 200);
  assert.deepEqual(cut.map((p) => p.length), [200, 200, 50]);
});

test("an empty changelog has no messages, and the file name comes from a plain version only", () => {
  assert.deepEqual(splitChangelog("  \n ", 2000), []);
  assert.equal(changelogFileName("0.29.0"), "changelog/0.29.0.md");
  assert.equal(changelogFileName("v0.29.0"), "changelog/0.29.0.md");
  assert.throws(() => changelogFileName("../secrets"));
  assert.throws(() => changelogFileName("0.29"));
});

import { changelogTitle, planChangelogPost } from "../../src/domain/changelog.ts";

test("the post title is the first heading, without markdown, cut to Discord's 100 characters", () => {
  assert.equal(changelogTitle("# 📣 What's new in 0.30.2\n\nText", "0.30.2"), "📣 What's new in 0.30.2");
  assert.equal(changelogTitle("no heading here", "0.30.2"), "What's new in 0.30.2");
  assert.equal(changelogTitle("# " + "x".repeat(150), "0.30.2").length, 100);
});

test("a text or announcement channel gets plain messages; a forum gets one post, the rest as replies", () => {
  const parts = ["first", "second", "third"];
  assert.deepEqual(planChangelogPost({ type: 0 }, parts, "Title"), { kind: "messages", messages: parts });
  assert.deepEqual(planChangelogPost({ type: 5 }, parts, "Title"), { kind: "messages", messages: parts });
  for (const type of [10, 11, 12]) assert.deepEqual(planChangelogPost({ type }, parts, "Title"), { kind: "messages", messages: parts }, `a thread or forum post (type ${type}) takes messages`);
  assert.deepEqual(planChangelogPost({ type: 15 }, parts, "Title"), { kind: "forum", name: "Title", first: "first", replies: ["second", "third"], tags: [] });
});

test("a forum that requires a tag gets the first tag; one that does not gets none; a channel of another kind is refused", () => {
  const tags = [{ id: "t1" }, { id: "t2" }];
  assert.deepEqual((planChangelogPost({ type: 15, flags: 1 << 4, available_tags: tags }, ["a"], "T") as any).tags, ["t1"]);
  assert.deepEqual((planChangelogPost({ type: 15, flags: 0, available_tags: tags }, ["a"], "T") as any).tags, []);
  assert.throws(() => planChangelogPost({ type: 2 }, ["a"], "T"), /cannot take/);
  assert.throws(() => planChangelogPost({ type: 15, flags: 1 << 4, available_tags: [] }, ["a"], "T"), /requires a tag/);
});
