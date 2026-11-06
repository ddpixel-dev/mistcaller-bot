import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { changelogMessage } from "../../src/render/changelog.ts";
import { RULE } from "../../src/render/theme.ts";
import { discordProblems } from "../helpers/discordLimits.ts";

const textOf = (m: any) => m.components[0].components[0].content as string;

test("a changelog message is a gold card like the roster: title, rule line, then the text", () => {
  const m: any = changelogMessage("# 📣 What's new in 0.31.2\n\nSomething new.", true);
  assert.equal(m.flags, 1 << 15);
  assert.equal(m.components[0].type, 17);
  assert.equal(m.content, undefined, "a card message has no plain content");
  assert.deepEqual(m.allowed_mentions, { parse: [] });
  assert.equal(textOf(m), `# 📣 What's new in 0.31.2\n${RULE}\nSomething new.`);
  assert.deepEqual(discordProblems(m), []);
});

test("later parts of a changelog carry no title rule, and a part with no title is left as it is", () => {
  assert.equal(textOf(changelogMessage("## ✨ More\ntext", false)), "## ✨ More\ntext");
  assert.equal(textOf(changelogMessage("plain line", true)), "plain line");
});

test("every changelog file fits the card and the rules of a message", () => {
  for (const f of ["0.0.1", "0.31.2"]) {
    const m = changelogMessage(readFileSync(new URL(`../../changelog/${f}.md`, import.meta.url), "utf8").trim(), true);
    assert.deepEqual(discordProblems(m), [], f);
  }
});
