import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { setCtaMessage } from "../../src/db/cta.ts";
import { postCtaMessage } from "../../src/handlers/ctamsg.ts";
import type { Deps } from "../../src/discord/dispatch.ts";

const GUILD = "100000000000000001";
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

type Opts = { source?: any; getThrows?: boolean; createThrows?: boolean; pinThrows?: boolean };
async function setup(o: Opts = {}, stored = true) {
  const sql = await testSql();
  if (stored) await setCtaMessage(sql, GUILD, "chan1", "msg1");
  const calls: { op: string; args: any[] }[] = [];
  const rest: any = {
    async getMessage(c: string, m: string) {
      calls.push({ op: "getMessage", args: [c, m] });
      if (o.getThrows) throw new Error("boom SECRET TEXT");
      return o.source ?? { ok: true, message: { content: "Join voice", embeds: [], attachments: [] } };
    },
    async createMessage(c: string, b: unknown) {
      calls.push({ op: "createMessage", args: [c, b] });
      if (o.createThrows) throw new Error("boom");
      return { id: "copy1" };
    },
    async pinMessage(c: string, m: string) {
      calls.push({ op: "pinMessage", args: [c, m] });
      if (o.pinThrows) throw new Error("boom");
    },
  };
  const deps = { sql, rest, now: () => new Date() } as unknown as Deps;
  return { deps, calls };
}
const run = (deps: Deps) => postCtaMessage(deps, { guildId: GUILD, threadId: "thr1" });

test("no setting stored: no calls, no notes", async () => {
  const { deps, calls } = await setup({}, false);
  assert.deepEqual(await run(deps), []);
  assert.deepEqual(calls, []);
});

test("reads the source, posts the copy in the thread, then pins it", async () => {
  const { deps, calls } = await setup();
  assert.deepEqual(await run(deps), []);
  assert.deepEqual(calls.map((c) => c.op), ["getMessage", "createMessage", "pinMessage"]);
  assert.deepEqual(calls[0]!.args, ["chan1", "msg1"]);
  assert.deepEqual(calls[1]!.args, ["thr1", { content: "Join voice", allowed_mentions: { parse: [] } }]);
  assert.deepEqual(calls[2]!.args, ["thr1", "copy1"]);
});

test("a missing or forbidden source gives one note and posts nothing", async () => {
  for (const reason of ["missing", "forbidden"]) {
    const { deps, calls } = await setup({ source: { ok: false, reason } });
    const notes = await run(deps);
    assert.equal(notes.length, 1);
    assert.ok(notes[0]!.startsWith("The CTA message was not added"), notes[0]);
    assert.ok(!calls.some((c) => c.op === "createMessage"));
  }
});

test("nothing to copy gives a note and no post", async () => {
  const { deps, calls } = await setup({ source: { ok: true, message: { content: "  ", embeds: [], attachments: [] } } });
  const notes = await run(deps);
  assert.equal(notes.length, 1);
  assert.ok(!calls.some((c) => c.op === "createMessage"));
});

test("a failing pin gives a note and the message stays", async () => {
  const { deps, calls } = await setup({ pinThrows: true });
  const notes = await run(deps);
  assert.equal(notes.length, 1);
  assert.ok(calls.some((c) => c.op === "createMessage"));
  assert.ok(!calls.some((c) => c.op === "deleteMessage"));
});

test("a failing createMessage or getMessage gives a note, does not throw and never leaks text", async () => {
  for (const o of [{ createThrows: true }, { getThrows: true }]) {
    const { deps } = await setup(o);
    const notes = await run(deps);
    assert.equal(notes.length, 1);
    assert.ok(!notes[0]!.includes("SECRET") && !notes[0]!.includes("Join voice"));
  }
});
