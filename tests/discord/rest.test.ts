import { test } from "node:test";
import assert from "node:assert/strict";
import { createRest, DiscordApiError } from "../../src/discord/rest.ts";
import { buildRegisterRequest, commands } from "../../src/discord/commands.ts";

const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("createRest retries once after 429 and returns the id", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const queue = [res(429, { retry_after: 0 }), res(200, { id: "m1" })];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return queue.shift()!;
  }) as unknown as typeof fetch;
  const rest = createRest("SECRET", fetchFn);
  const out = await rest.createMessage("c1", { content: "x" });
  assert.deepEqual(out, { id: "m1" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.url, "https://discord.com/api/v10/channels/c1/messages");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bot SECRET");
  assert.equal(calls[0]!.init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { content: "x" });
});

test("createRest throws DiscordApiError with status on 500, without the token", async () => {
  const fetchFn = (async () => res(500, { message: "boom" })) as unknown as typeof fetch;
  const rest = createRest("SECRET", fetchFn);
  await assert.rejects(rest.createMessage("c1", {}), (e: unknown) => {
    assert.ok(e instanceof DiscordApiError);
    assert.equal(e.status, 500);
    assert.ok(!e.message.includes("SECRET"));
    return true;
  });
});

test("createRest gives up if 429 repeats", async () => {
  const fetchFn = (async () => res(429, { retry_after: 0 })) as unknown as typeof fetch;
  await assert.rejects(createRest("T", fetchFn).createMessage("c", {}), (e: unknown) => {
    assert.ok(e instanceof DiscordApiError);
    assert.equal(e.status, 429);
    return true;
  });
});

test("editMessage PATCHes the message", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fetchFn = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return res(200, { id: "m1" });
  }) as unknown as typeof fetch;
  await createRest("T", fetchFn).editMessage("c1", "m1", { content: "y" });
  assert.equal(seen!.url, "https://discord.com/api/v10/channels/c1/messages/m1");
  assert.equal(seen!.init.method, "PATCH");
});

test("buildRegisterRequest builds URL, headers and body", () => {
  const r = buildRegisterRequest({ appId: "A1", guildId: "G1", token: "SECRET" });
  assert.equal(r.url, "https://discord.com/api/v10/applications/A1/guilds/G1/commands");
  assert.equal(r.init.method, "PUT");
  const h = r.init.headers as Record<string, string>;
  assert.equal(h.Authorization, "Bot SECRET");
  assert.equal(h["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(r.init.body as string), commands);
  const create = commands[0]!.options[0]!;
  assert.equal(commands[0]!.name, "content");
  assert.equal(create.name, "create");
  assert.deepEqual(create.options[0], { type: 5, name: "loot", description: create.options[0]!.description, required: false });
});
