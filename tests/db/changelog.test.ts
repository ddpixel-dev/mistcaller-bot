import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { clearChangelogChannel, getChangelogChannel, markChangelogPosted, pendingChangelogTargets, setChangelogChannel } from "../../src/db/changelog.ts";

beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

test("a server has at most one changelog channel; setting it again moves it, clearing it removes it", async () => {
  const sql = await testSql();
  assert.equal(await getChangelogChannel(sql, "g1"), null);
  await setChangelogChannel(sql, "g1", "c1");
  await setChangelogChannel(sql, "g1", "c2");
  assert.equal(await getChangelogChannel(sql, "g1"), "c2");
  assert.equal(await clearChangelogChannel(sql, "g1"), true);
  assert.equal(await clearChangelogChannel(sql, "g1"), false);
  assert.equal(await getChangelogChannel(sql, "g1"), null);
});

test("a version is posted once per server: pending targets skip servers that have it, marking twice says no", async () => {
  const sql = await testSql();
  await setChangelogChannel(sql, "g1", "c1");
  await setChangelogChannel(sql, "g2", "c2");
  assert.deepEqual((await pendingChangelogTargets(sql, "0.29.0")).map((t) => t.guildId).sort(), ["g1", "g2"]);
  assert.equal(await markChangelogPosted(sql, "g1", "0.29.0", new Date()), true);
  assert.equal(await markChangelogPosted(sql, "g1", "0.29.0", new Date()), false);
  assert.deepEqual(await pendingChangelogTargets(sql, "0.29.0"), [{ guildId: "g2", channelId: "c2" }]);
  assert.equal((await pendingChangelogTargets(sql, "0.30.0")).length, 2, "a new version is pending again");
});
