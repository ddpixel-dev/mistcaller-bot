import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testSql, resetDb } from "../helpers/db.ts";
import { createContent, setMessageId, getRosterView, type NewContent } from "../../src/db/content.ts";
import { claimSlot } from "../../src/db/signup.ts";
import { castVote } from "../../src/db/vote.ts";
import { isAuthorized, lockStarted, postVoteResults, runJobs } from "../../src/jobs/cron.ts";
import * as cronRoute from "../../api/cron.ts";
import { handleCron } from "../../src/jobs/cron-handler.ts";
import { DiscordApiError, type Rest } from "../../src/discord/rest.ts";
import type { Deps } from "../../src/discord/dispatch.ts";

const startsAt = new Date("2026-12-01T18:00:00Z");
const CUTOFF = new Date(startsAt.getTime() - 300000);
const EARLY = new Date(CUTOFF.getTime() - 1000);
const base: NewContent = {
  guildId: "g1", threadId: "t1", type: "pvp", title: "Loot run", notes: null, startsAt,
  tier: { min: { tier: 8, enchant: 0 }, max: null }, hasLoot: true, createdBy: "u1",
  slots: [{ role: "Tank", weapon: "Mace" }, { role: "Healer", weapon: "Holy" }, { role: "DPS", weapon: "Bow" }],
};

type Calls = { edits: { channel: string; message: string; body: any }[]; posts: { channel: string; body: any }[] };
function fakeRest(opts: { edit?: () => Error | undefined; post?: () => Error | undefined } = {}) {
  const calls: Calls = { edits: [], posts: [] };
  const rest: Rest = {
    async createMessage(channel, body) {
      const e = opts.post?.();
      if (e) throw e;
      calls.posts.push({ channel, body });
      return { id: "p" + calls.posts.length };
    },
    async editMessage(channel, message, body) {
      const e = opts.edit?.();
      if (e) throw e;
      calls.edits.push({ channel, message, body });
    },
    async deleteMessage() {},
  };
  return { rest, calls };
}

beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

async function make(over: Partial<NewContent> = {}, messageId: string | null = "m1") {
  const sql = await testSql();
  const id = await createContent(sql, { ...base, ...over });
  if (messageId) await setMessageId(sql, id, messageId);
  return { sql, id };
}
const posted = async (sql: any, id: string) =>
  (await sql`select loot_result_posted_at as p from content where id = ${id}`)[0].p;
const status = async (sql: any, id: string) =>
  (await sql`select status from content where id = ${id}`)[0].status;

test("isAuthorized", () => {
  assert.equal(isAuthorized("Bearer s3cret", "s3cret"), true);
  assert.equal(isAuthorized("Bearer wrong!", "s3cret"), false);
  assert.equal(isAuthorized("Bearer x", "s3cret"), false);
  assert.equal(isAuthorized(null, "s3cret"), false);
  assert.equal(isAuthorized("Bearer ", "s3cret"), false);
  assert.equal(isAuthorized("Basic s3cret", "s3cret"), false);
  assert.equal(isAuthorized("s3cret", "s3cret"), false);
  assert.equal(isAuthorized("Bearer ", ""), false);
  assert.equal(isAuthorized("Bearer", ""), false);
  assert.equal(isAuthorized("", ""), false);
});

test("lockStarted locks only started open content, edits once, second run 0", async () => {
  const { sql, id } = await make({ startsAt: new Date("2026-12-01T18:00:00Z") });
  const { id: later } = await make({ threadId: "t2", startsAt: new Date("2026-12-01T20:00:00Z") }, "m2");
  const { rest, calls } = fakeRest();
  const deps: Deps = { sql, rest, now: () => new Date("2026-12-01T18:00:00Z") };
  assert.equal(await lockStarted(deps), 1);
  assert.equal(await status(sql, id), "locked");
  assert.equal(await status(sql, later), "open");
  assert.equal(calls.edits.length, 1);
  assert.deepEqual([calls.edits[0]!.channel, calls.edits[0]!.message], ["t1", "m1"]);
  assert.equal(await lockStarted(deps), 0);
  assert.equal(calls.edits.length, 1);
});

test("lockStarted skips the edit when message_id is null and survives a 404", async () => {
  const { sql, id } = await make({}, null);
  const { rest, calls } = fakeRest();
  const now = () => new Date("2026-12-02T00:00:00Z");
  assert.equal(await lockStarted({ sql, rest, now }), 1);
  assert.equal(calls.edits.length, 0);
  assert.equal(await status(sql, id), "locked");

  const b = await make({ threadId: "t9" }, "m9");
  const f = fakeRest({ edit: () => new DiscordApiError(404, "gone") });
  assert.equal(await lockStarted({ sql, rest: f.rest, now }), 1);
  assert.equal(await status(sql, b.id), "locked");
});

test("lockStarted keeps the DB lock when Discord fails with 500", async () => {
  const { sql, id } = await make();
  const f = fakeRest({ edit: () => new DiscordApiError(500, "boom") });
  assert.equal(await lockStarted({ sql, rest: f.rest, now: () => new Date("2026-12-02T00:00:00Z") }), 1);
  assert.equal(await status(sql, id), "locked");
});

test("postVoteResults does nothing before start minus 5 minutes", async () => {
  const { sql, id } = await make();
  const { rest, calls } = fakeRest();
  assert.equal(await postVoteResults({ sql, rest, now: () => EARLY }), 0);
  assert.equal(calls.edits.length + calls.posts.length, 0);
  assert.equal(await posted(sql, id), null);
});

test("postVoteResults at the cutoff: one edit, one thread message, marked, second run 0", async () => {
  const { sql, id } = await make();
  const slots = (await getRosterView(sql, id, EARLY))!.slots.map((s) => s.id);
  for (const [i, u] of ["a", "b", "c"].entries())
    await claimSlot(sql, { contentId: id, slotId: slots[i]!, userId: u, guildId: "g1" });
  for (const [u, c] of [["a", "split"], ["b", "split"], ["c", "regear"]] as const)
    assert.equal(await castVote(sql, { contentId: id, userId: u, guildId: "g1", choice: c, now: EARLY }), "recorded");
  const { rest, calls } = fakeRest();
  const deps: Deps = { sql, rest, now: () => CUTOFF };
  assert.equal(await postVoteResults(deps), 1);
  assert.equal(calls.edits.length, 1);
  assert.ok(JSON.stringify(calls.edits[0]!.body).includes("Loot vote result: Split won 2-1"));
  assert.equal(calls.posts.length, 1);
  assert.equal(calls.posts[0]!.channel, "t1");
  assert.equal(calls.posts[0]!.body.content, "Loot vote result: Split won 2-1");
  assert.deepEqual(calls.posts[0]!.body.allowed_mentions, { parse: [] });
  assert.deepEqual(await posted(sql, id), CUTOFF);
  assert.equal(await postVoteResults(deps), 0);
  assert.equal(calls.posts.length, 1);
  assert.equal(calls.edits.length, 1);
});

test("postVoteResults with no votes says no votes", async () => {
  const { sql } = await make();
  const { rest, calls } = fakeRest();
  await postVoteResults({ sql, rest, now: () => CUTOFF });
  assert.equal(calls.posts[0]!.body.content, "Loot vote result: no votes");
});

test("postVoteResults never touches content without loot, cancelled or done", async () => {
  const a = await make({ hasLoot: false });
  const b = await make({ threadId: "t2" }, "m2");
  const c = await make({ threadId: "t3" }, "m3");
  await a.sql`update content set status = 'cancelled' where id = ${b.id}`;
  await a.sql`update content set status = 'done' where id = ${c.id}`;
  const { rest, calls } = fakeRest();
  assert.equal(await postVoteResults({ sql: a.sql, rest, now: () => startsAt }), 0);
  assert.equal(calls.edits.length + calls.posts.length, 0);
  assert.equal(await posted(a.sql, a.id), null);
});

test("500 on edit leaves it unmarked; a later run with a working Rest posts exactly once", async () => {
  const { sql, id } = await make();
  const bad = fakeRest({ edit: () => new DiscordApiError(500, "boom") });
  const deps = (rest: Rest): Deps => ({ sql, rest, now: () => CUTOFF });
  assert.equal(await postVoteResults(deps(bad.rest)), 0);
  assert.equal(await posted(sql, id), null);
  assert.equal(bad.calls.posts.length, 0);
  const good = fakeRest();
  assert.equal(await postVoteResults(deps(good.rest)), 1);
  assert.equal(good.calls.posts.length, 1);
  assert.notEqual(await posted(sql, id), null);
});

test("429 and non-Discord errors also leave it for retry", async () => {
  const { sql, id } = await make();
  for (const err of [new DiscordApiError(429, "rl"), new TypeError("network")]) {
    const f = fakeRest({ edit: () => err });
    assert.equal(await postVoteResults({ sql, rest: f.rest, now: () => CUTOFF }), 0);
    assert.equal(await posted(sql, id), null);
  }
});

test("thread message failure unmarks; retry posts the message once", async () => {
  const { sql, id } = await make();
  const bad = fakeRest({ post: () => new DiscordApiError(503, "down") });
  assert.equal(await postVoteResults({ sql, rest: bad.rest, now: () => CUTOFF }), 0);
  assert.equal(await posted(sql, id), null);
  const good = fakeRest();
  assert.equal(await postVoteResults({ sql, rest: good.rest, now: () => CUTOFF }), 1);
  assert.equal(await postVoteResults({ sql, rest: good.rest, now: () => CUTOFF }), 0);
  assert.equal(good.calls.posts.length, 1);
});

test("404 on the roster edit still posts the thread message and marks", async () => {
  const { sql, id } = await make();
  const f = fakeRest({ edit: () => new DiscordApiError(404, "gone") });
  assert.equal(await postVoteResults({ sql, rest: f.rest, now: () => CUTOFF }), 1);
  assert.equal(f.calls.posts.length, 1);
  assert.notEqual(await posted(sql, id), null);
});

test("null message_id skips the edit but still posts and marks", async () => {
  const { sql, id } = await make({}, null);
  const f = fakeRest();
  assert.equal(await postVoteResults({ sql, rest: f.rest, now: () => CUTOFF }), 1);
  assert.equal(f.calls.edits.length, 0);
  assert.equal(f.calls.posts.length, 1);
  assert.notEqual(await posted(sql, id), null);
});

test("one failing content does not stop the other", async () => {
  const a = await make({ threadId: "bad" }, "m1");
  const b = await make({ threadId: "good" }, "m2");
  const f = fakeRest({ edit: undefined });
  const rest: Rest = {
    ...f.rest,
    async editMessage(ch, m, body) {
      if (ch === "bad") throw new DiscordApiError(500, "boom");
      return f.rest.editMessage(ch, m, body);
    },
  };
  assert.equal(await postVoteResults({ sql: a.sql, rest, now: () => CUTOFF }), 1);
  assert.equal(await posted(a.sql, a.id), null);
  assert.notEqual(await posted(a.sql, b.id), null);
  assert.deepEqual(f.calls.posts.map((p) => p.channel), ["good"]);
});

test("two concurrent runs post exactly one thread message", async () => {
  const { sql } = await make();
  const f = fakeRest();
  const slow: Rest = {
    ...f.rest,
    async editMessage(c, m, b) { await new Promise((r) => setTimeout(r, 100)); return f.rest.editMessage(c, m, b); },
  };
  const deps: Deps = { sql, rest: slow, now: () => CUTOFF };
  const [x, y] = await Promise.all([postVoteResults(deps), postVoteResults(deps)]);
  assert.equal(x + y, 1);
  assert.equal(f.calls.posts.length, 1);
});

test("runJobs posts results before locking, even when both are due", async () => {
  const { sql, id } = await make();
  const order: string[] = [];
  const f = fakeRest();
  const rest: Rest = {
    ...f.rest,
    async createMessage(c, b) { order.push("post"); return f.rest.createMessage(c, b); },
    async editMessage(c, m, b) {
      order.push(`edit:${(await sql`select status from content where id = ${id}`)[0]!.status}`);
      return f.rest.editMessage(c, m, b);
    },
  };
  const out = await runJobs({ sql, rest, now: () => startsAt });
  assert.deepEqual(out, { locked: 1, resultsPosted: 1 });
  assert.deepEqual(order, ["edit:open", "post", "edit:locked"]);
  assert.equal(await status(sql, id), "locked");
  assert.deepEqual(await runJobs({ sql, rest, now: () => startsAt }), { locked: 0, resultsPosted: 0 });
});

// cron handler
const req = (header?: string) =>
  new Request("https://x/api/cron", { method: "POST", headers: header ? { authorization: header } : {} });

test("handleCron: 401 without or with wrong secret, jobs not called", async () => {
  let called = 0;
  const run = async () => { called++; return { locked: 1, resultsPosted: 2 }; };
  for (const h of [undefined, "Bearer nope"]) {
    const r = await handleCron(req(h), { secret: "s3cret", run });
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: "unauthorized" });
  }
  assert.equal(called, 0);
});

test("handleCron: 200 with counts", async () => {
  const r = await handleCron(req("Bearer s3cret"), { secret: "s3cret", run: async () => ({ locked: 3, resultsPosted: 2 }) });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { locked: 3, resultsPosted: 2 });
});

test("handleCron: 500 generic when the secret is unset, even with a header", async () => {
  let called = 0;
  for (const secret of [undefined, ""]) {
    const r = await handleCron(req("Bearer "), { secret, run: async () => { called++; return { locked: 0, resultsPosted: 0 }; } });
    assert.equal(r.status, 500);
    assert.ok(!(await r.text()).includes("CRON_SECRET"));
  }
  assert.equal(called, 0);
});

test("handleCron: 500 when the jobs throw, body does not echo the error", async () => {
  const r = await handleCron(req("Bearer s3cret"), { secret: "s3cret", run: async () => { throw new Error("password=hunter2"); } });
  assert.equal(r.status, 500);
  assert.ok(!(await r.text()).includes("hunter2"));
});

test("workflow file has the required lines", () => {
  const y = readFileSync(new URL("../../.github/workflows/cron.yml", import.meta.url), "utf8");
  assert.match(y, /cron: "\*\/5 \* \* \* \*"/);
  assert.match(y, /workflow_dispatch:/);
  assert.match(y, /^permissions: \{\}$/m);
  assert.match(y, /runs-on: ubuntu-latest/);
  assert.match(y, /timeout-minutes: \d+/);
  assert.match(y, /CRON_URL: \$\{\{ secrets\.CRON_URL \}\}/);
  assert.match(y, /CRON_SECRET: \$\{\{ secrets\.CRON_SECRET \}\}/);
  assert.ok(y.includes('curl --fail --silent --show-error -X POST -H "Authorization: Bearer $CRON_SECRET" "$CRON_URL"'));
  assert.ok(!/echo/.test(y));
});

test("api/cron: unauthorized with other env unset is 401 and builds nothing", async () => {
  const saved = { ...process.env };
  try {
    process.env.CRON_SECRET = "s3cret";
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.DATABASE_URL;
    const r = await cronRoute.POST(req("Bearer nope"));
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: "unauthorized" });
    assert.equal((await cronRoute.GET(req())).status, 401);
  } finally {
    process.env = saved;
  }
});

test("api/cron: authorized with DATABASE_URL unset is a generic 500", async () => {
  const saved = { ...process.env };
  try {
    process.env.CRON_SECRET = "s3cret-value-xyz";
    process.env.DISCORD_BOT_TOKEN = "tok-value-xyz";
    delete process.env.DATABASE_URL;
    const r = await cronRoute.POST(req("Bearer s3cret-value-xyz"));
    assert.equal(r.status, 500);
    const body = await r.text();
    assert.ok(!body.includes("xyz") && !body.includes("DATABASE_URL"), body);
  } finally {
    process.env = saved;
  }
});

test("three due rows, middle fails: other two posted, failed one unclaimed and attempted once", async () => {
  const a = await make({ threadId: "ta", startsAt: new Date("2026-12-01T18:00:00Z") }, "m1");
  await make({ threadId: "tb", startsAt: new Date("2026-12-01T18:00:00Z") }, "m2");
  await make({ threadId: "tc", startsAt: new Date("2026-12-01T18:00:00Z") }, "m3");
  const f = fakeRest();
  const attempts: string[] = [];
  const rest: Rest = {
    ...f.rest,
    async editMessage(ch, m, b) {
      attempts.push(ch);
      if (ch === "tb") throw new DiscordApiError(500, "boom");
      return f.rest.editMessage(ch, m, b);
    },
  };
  assert.equal(await postVoteResults({ sql: a.sql, rest, now: () => CUTOFF }), 2);
  assert.deepEqual(attempts.sort(), ["ta", "tb", "tc"]);
  assert.deepEqual(f.calls.posts.map((p) => p.channel).sort(), ["ta", "tc"]);
  const rows = await a.sql`select thread_id, loot_result_posted_at as p from content order by thread_id`;
  assert.deepEqual(rows.map((r: any) => r.p === null), [false, true, false]);
  assert.equal(await postVoteResults({ sql: a.sql, rest: fakeRest().rest, now: () => CUTOFF }), 1);
});

test("conditional release does not clear a claim with a different timestamp", async () => {
  const { sql, id } = await make();
  const other = new Date("2026-11-30T00:00:00Z");
  const rest: Rest = {
    ...fakeRest().rest,
    async editMessage() {
      await sql`update content set loot_result_posted_at = ${other} where id = ${id}`;
      throw new DiscordApiError(500, "boom");
    },
  };
  assert.equal(await postVoteResults({ sql, rest, now: () => CUTOFF }), 0);
  assert.deepEqual(await posted(sql, id), other);
});

test("at most 25 rows are processed in one run", async () => {
  const { sql } = await make({ threadId: "t0" }, "m0");
  for (let i = 1; i < 30; i++) await make({ threadId: `t${i}` }, `m${i}`);
  const f = fakeRest();
  assert.equal(await postVoteResults({ sql, rest: f.rest, now: () => CUTOFF }), 25);
  assert.equal(f.calls.posts.length, 25);
  assert.equal(await postVoteResults({ sql, rest: f.rest, now: () => CUTOFF }), 5);
});
