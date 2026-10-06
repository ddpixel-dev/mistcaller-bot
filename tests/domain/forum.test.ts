import { test } from "node:test";
import assert from "node:assert/strict";
import { forumContentType } from "../../src/domain/forum.ts";
import type { GuildSettings } from "../../src/db/settings.ts";

const s: GuildSettings = { guildId: "g", officerRoleId: null, pvpForumId: "100", pveForumId: "200", dailyCap: 5 };

test("forumContentType maps forum ids", () => {
  assert.equal(forumContentType(s, "100"), "pvp");
  assert.equal(forumContentType(s, "200"), "pve");
  assert.equal(forumContentType(s, "300"), null);
  assert.equal(forumContentType(s, null), null);
});
