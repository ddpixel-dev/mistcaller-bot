import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testSql, resetDb } from "../helpers/db.ts";
import { setCtaMessage } from "../../src/db/cta.ts";
import { postCtaMessage } from "../../src/handlers/ctamsg.ts";
import { DiscordApiError } from "../../src/discord/rest.ts";
import type { Deps } from "../../src/discord/dispatch.ts";

const GUILD = "100000000000000001";
beforeEach(async () => { await resetDb(await testSql()); });
after(async () => { await (await testSql()).end(); });

type Opts = { createError?: unknown; pinThrows?: boolean; noPin?: boolean };
async function setup(o: Opts = {}, stored = true) {
  const sql = await testSql();
  if (stored) await setCtaMessage(sql, GUILD, "chan1", "msg1");
  const calls: { op: string; args: any[] }[] = [];
  const rest: any = {
    async getMessage(c: string, m: string) {
      calls.push({ op: "getMessage", args: [c, m] });
      return { ok: true };
    },
    async createMessage(c: string, b: unknown) {
      calls.push({ op: "createMessage", args: [c, b] });
      if (o.createError) throw o.createError;
      return { id: "fwd1" };
    },
  };
  if (!o.noPin) {
    rest.pinMessage = async (c: string, m: string) => {
      calls.push({ op: "pinMessage", args: [c, m] });
      if (o.pinThrows) throw new Error("boom SECRET TEXT");
    };
  }
  const deps = { sql, rest, now: () => new Date() } as unknown as Deps;
  return { deps, calls };
}
const run = (deps: Deps) => postCtaMessage(deps, { guildId: GUILD, threadId: "thr1" });

test("no setting stored: no calls, no notes", async () => {
  const { deps, calls } = await setup({}, false);
  assert.deepEqual(await run(deps), []);
  assert.deepEqual(calls, []);
});

test("forwards the source into the thread without reading it, then pins the forward", async () => {
  const { deps, calls } = await setup();
  assert.deepEqual(await run(deps), []);
  assert.deepEqual(calls.map((c) => c.op), ["createMessage", "pinMessage"]);
  assert.deepEqual(calls[0]!.args, ["thr1", {
    message_reference: { type: 1, guild_id: GUILD, channel_id: "chan1", message_id: "msg1", fail_if_not_exists: true },
    allowed_mentions: { parse: [] },
  }]);
  assert.deepEqual(calls[1]!.args, ["thr1", "fwd1"]);
});

const GONE = "The CTA message was not added: the message or its channel no longer exists. Ask an admin to set it again with /content setup cta-msg.";
const CANNOT_OPEN = "The CTA message was not added: the bot cannot open it. Ask an admin to give the bot View Channel and Read Message History on that channel.";

test("a failed forward gives the matching note and no pin", async () => {
  const cases: [unknown, string][] = [
    [new DiscordApiError(404, "x"), GONE],
    [new DiscordApiError(400, "x", 10008), GONE],
    [new DiscordApiError(400, "x", 10003), GONE],
    [new DiscordApiError(403, "x"), CANNOT_OPEN],
    [new DiscordApiError(400, "x", 50001), CANNOT_OPEN],
    [new DiscordApiError(400, "x", 50013), CANNOT_OPEN],
  ];
  for (const [createError, note] of cases) {
    const { deps, calls } = await setup({ createError });
    assert.deepEqual(await run(deps), [note]);
    assert.ok(!calls.some((c) => c.op === "pinMessage"));
  }
});

test("any other failure gives a generic note, does not throw and never leaks text", async () => {
  for (const createError of [new Error("boom SECRET TEXT"), new DiscordApiError(500, "x")]) {
    const { deps } = await setup({ createError });
    const notes = await run(deps);
    assert.equal(notes.length, 1);
    assert.ok(notes[0]!.startsWith("The CTA message was not added"));
    assert.ok(!notes[0]!.includes("SECRET") && notes[0] !== GONE && notes[0] !== CANNOT_OPEN);
  }
});

const NOT_PINNED = "The CTA message was added but not pinned. Ask an admin to give the bot Pin Messages in the CTA channel.";

test("a failing pin, or no pin support, gives the pin note and the message stays", async () => {
  for (const o of [{ pinThrows: true }, { noPin: true }]) {
    const { deps, calls } = await setup(o);
    assert.deepEqual(await run(deps), [NOT_PINNED]);
    assert.ok(calls.some((c) => c.op === "createMessage"));
    assert.ok(!calls.some((c) => c.op === "deleteMessage"));
  }
});

test("a failed forward or pin logs the status and code but never any text", async () => {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (m: unknown) => { logged.push(String(m)); };
  try {
    await run((await setup({ createError: new Error("boom SECRET TEXT") })).deps);
    await run((await setup({ pinThrows: true })).deps);
  } finally { console.error = orig; }
  assert.ok(logged.length >= 2);
  assert.ok(logged.every((l) => !l.includes("SECRET")), logged.join());
});
