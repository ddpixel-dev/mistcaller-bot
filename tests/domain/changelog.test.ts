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
