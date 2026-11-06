import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { clearCtaForum, getCtaForum, getCtaRoleIds, MAX_CTA_ROLES, setCtaForum, setCtaRoles } from "../../src/db/cta.ts";
import { createContent, getRosterView } from "../../src/db/content.ts";

beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

test("a server has at most one CTA forum; setting it again moves it, clearing it removes it", async () => {
  const sql = await testSql();
  assert.equal(await getCtaForum(sql, "g1"), null);
  await setCtaForum(sql, "g1", "f1");
  await setCtaForum(sql, "g1", "f2");
  assert.equal(await getCtaForum(sql, "g1"), "f2");
  assert.equal(await getCtaForum(sql, "g2"), null);
  assert.equal(await clearCtaForum(sql, "g1"), true);
  assert.equal(await clearCtaForum(sql, "g1"), false);
});

test("the CTA roles are replaced as a whole, per server, and capped", async () => {
  const sql = await testSql();
  await setCtaRoles(sql, "g1", ["r1", "r2", "r2"]);
  await setCtaRoles(sql, "g2", ["x"]);
  assert.deepEqual((await getCtaRoleIds(sql, "g1")).sort(), ["r1", "r2"]);
  await setCtaRoles(sql, "g1", ["r2", "r3"]);
  assert.deepEqual((await getCtaRoleIds(sql, "g1")).sort(), ["r2", "r3"]);
  assert.deepEqual(await getCtaRoleIds(sql, "g2"), ["x"]);
  await setCtaRoles(sql, "g1", []);
  assert.deepEqual(await getCtaRoleIds(sql, "g1"), []);
  await assert.rejects(setCtaRoles(sql, "g1", Array.from({ length: MAX_CTA_ROLES + 1 }, (_, i) => `r${i}`)));
});

test("content can be a CTA and can be blank, with no slots", async () => {
  const sql = await testSql();
  const start = new Date("2026-12-01T18:00:00Z");
  const id = await createContent(sql, {
    guildId: "g1", threadId: "t1", type: "pvx", title: "Call to arms", notes: "bring food", startsAt: start, tier: "T8", hasLoot: false,
    createdBy: "o", now: new Date(start.getTime() - 3600000), slots: [], cta: true, blank: true,
  });
  const v = (await getRosterView(sql, id, new Date(start.getTime() - 3600000)))!;
  assert.deepEqual([v.cta, v.blank, v.slots.length], [true, true, 0]);
  const plain = await createContent(sql, {
    guildId: "g1", threadId: "t2", type: "pvp", title: "Raid", notes: null, startsAt: start, tier: "T8", hasLoot: false,
    createdBy: "o", now: new Date(start.getTime() - 3600000), slots: [{ role: "Tank", weapon: "" }],
  });
  const p = (await getRosterView(sql, plain, new Date(start.getTime() - 3600000)))!;
  assert.deepEqual([p.cta, p.blank], [false, false]);
});
