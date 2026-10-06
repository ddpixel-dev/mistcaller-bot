import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { handleDiscordRequest, verifySignature, isFresh } from "../../src/http/discord-handler.ts";
import type { Dispatch } from "../../src/discord/types.ts";

function makeKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, publicHex: der.subarray(der.length - 32).toString("hex") };
}

const NOW = new Date("2026-10-06T12:00:00Z");
const ts = (d: Date) => String(Math.floor(d.getTime() / 1000));

function signed(privateKey: KeyObject, timestamp: string, body: string) {
  return sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");
}

function setup() {
  const k = makeKey();
  let calls = 0;
  const dispatch: Dispatch = async () => {
    calls++;
    return { type: 4, data: { content: "hi" } };
  };
  const call = (body: string, headers: Record<string, string>) =>
    handleDiscordRequest(
      new Request("https://x.test/api/discord", { method: "POST", body, headers }),
      { publicKey: k.publicHex, dispatch, now: () => NOW },
    );
  const goodHeaders = (body: string, t = ts(NOW)) => ({
    "x-signature-ed25519": signed(k.privateKey, t, body),
    "x-signature-timestamp": t,
  });
  return { k, call, goodHeaders, calls: () => calls };
}

test("valid ping returns pong", async () => {
  const s = setup();
  const body = '{"type":1}';
  const res = await s.call(body, s.goodHeaders(body));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { type: 1 });
});

test("altered body is 401 and not dispatched", async () => {
  const s = setup();
  const h = s.goodHeaders('{"type":2}');
  const res = await s.call('{"type":2,"x":1}', h);
  assert.equal(res.status, 401);
  assert.equal(s.calls(), 0);
});

test("signature from another key is 401", async () => {
  const s = setup();
  const other = makeKey();
  const body = '{"type":1}';
  const t = ts(NOW);
  const res = await s.call(body, {
    "x-signature-ed25519": signed(other.privateKey, t, body),
    "x-signature-timestamp": t,
  });
  assert.equal(res.status, 401);
});

test("missing headers is 401", async () => {
  const s = setup();
  const body = '{"type":1}';
  const h = s.goodHeaders(body);
  assert.equal((await s.call(body, {})).status, 401);
  assert.equal((await s.call(body, { "x-signature-ed25519": h["x-signature-ed25519"] })).status, 401);
  assert.equal((await s.call(body, { "x-signature-timestamp": h["x-signature-timestamp"] })).status, 401);
});

test("stale timestamp is 401", async () => {
  const s = setup();
  const body = '{"type":1}';
  const old = ts(new Date(NOW.getTime() - 301_000));
  const res = await s.call(body, s.goodHeaders(body, old));
  assert.equal(res.status, 401);
});

test("non-JSON: valid signature 400, bad signature 401", async () => {
  const s = setup();
  const body = "not json";
  assert.equal((await s.call(body, s.goodHeaders(body))).status, 400);
  const h = s.goodHeaders("other");
  assert.equal((await s.call(body, h)).status, 401);
});

test("type 2 returns dispatch result", async () => {
  const s = setup();
  const body = JSON.stringify({ id: "1", type: 2, application_id: "a", token: "t" });
  const res = await s.call(body, s.goodHeaders(body));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { type: 4, data: { content: "hi" } });
  assert.equal(s.calls(), 1);
});

test("verifySignature false on garbage key; isFresh window", () => {
  assert.equal(verifySignature("b", "zz", "1", "nothex"), false);
  assert.equal(isFresh(ts(NOW), NOW), true);
  assert.equal(isFresh("abc", NOW), false);
});
