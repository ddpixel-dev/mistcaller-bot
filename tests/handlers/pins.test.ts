import { test } from "node:test";
import assert from "node:assert/strict";
import { pinQuietly } from "../../src/handlers/pins.ts";
import { DiscordApiError } from "../../src/discord/rest.ts";
import type { Deps } from "../../src/discord/dispatch.ts";

type Opts = { messages?: any[]; listThrows?: unknown; deleteThrows?: unknown; pinThrows?: unknown; noPin?: boolean; noList?: boolean };
function setup(o: Opts = {}) {
  const calls: { op: string; args: any[] }[] = [];
  const rest: any = {
    async deleteMessage(c: string, m: string) {
      calls.push({ op: "deleteMessage", args: [c, m] });
      if (o.deleteThrows) throw o.deleteThrows;
    },
  };
  if (!o.noPin) rest.pinMessage = async (c: string, m: string) => { calls.push({ op: "pinMessage", args: [c, m] }); if (o.pinThrows) throw o.pinThrows; };
  if (!o.noList) rest.listMessages = async (c: string, n: number) => { calls.push({ op: "listMessages", args: [c, n] }); if (o.listThrows) throw o.listThrows; return o.messages ?? []; };
  return { deps: { rest } as unknown as Deps, calls };
}
const notice = { id: "n1", type: 6, message_reference: { message_id: "m1" } };

test("pins, then deletes the pin notice", async () => {
  const { deps, calls } = setup({ messages: [notice, { id: "m1", type: 0 }] });
  assert.equal(await pinQuietly(deps, "c1", "m1"), true);
  assert.deepEqual(calls, [
    { op: "pinMessage", args: ["c1", "m1"] },
    { op: "listMessages", args: ["c1", 5] },
    { op: "deleteMessage", args: ["c1", "n1"] },
  ]);
});

test("no notice found: nothing deleted", async () => {
  const { deps, calls } = setup({ messages: [{ id: "x", type: 0 }] });
  assert.equal(await pinQuietly(deps, "c1", "m1"), true);
  assert.ok(!calls.some((c) => c.op === "deleteMessage"));
});

test("a failed list still counts as pinned and does not throw", async () => {
  const { deps } = setup({ listThrows: new DiscordApiError(403, "x") });
  assert.equal(await pinQuietly(deps, "c1", "m1"), true);
});

test("a failed delete (403) still counts as pinned, logs without text", async () => {
  const { deps } = setup({ messages: [notice], deleteThrows: new DiscordApiError(403, "Missing SECRET", 50013) });
  const logs: string[] = [];
  const orig = console.error;
  console.error = (s: string) => { logs.push(String(s)); };
  try { assert.equal(await pinQuietly(deps, "c1", "m1"), true); } finally { console.error = orig; }
  assert.equal(logs.length, 1);
  const j = JSON.parse(logs[0]!);
  assert.deepEqual(j, { evt: "pin_notice_delete_failed", name: "DiscordApiError", status: 403, code: 50013 });
});

test("a pin failure is rethrown and nothing else is called", async () => {
  const err = new Error("nope");
  const { deps, calls } = setup({ pinThrows: err });
  await assert.rejects(pinQuietly(deps, "c1", "m1"), err);
  assert.deepEqual(calls.map((c) => c.op), ["pinMessage"]);
});

test("without listMessages the pin works and nothing else happens; without pinMessage it returns false", async () => {
  const a = setup({ noList: true });
  assert.equal(await pinQuietly(a.deps, "c1", "m1"), true);
  assert.deepEqual(a.calls.map((c) => c.op), ["pinMessage"]);
  const b = setup({ noPin: true });
  assert.equal(await pinQuietly(b.deps, "c1", "m1"), false);
  assert.deepEqual(b.calls, []);
});
