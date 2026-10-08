import { test } from "node:test";
import assert from "node:assert/strict";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import { commands } from "../../src/discord/commands.ts";
import { HELP_TEXT } from "../../src/handlers/help.ts";
import type { Interaction } from "../../src/discord/types.ts";

const deps = {} as Deps; // help touches neither the database nor Discord
const help = (over: Partial<Interaction> = {}): Interaction => ({
  id: "i", type: 2, application_id: "a", token: "t", guild_id: "100000001", channel_id: "c",
  member: { user: { id: "u1" }, roles: [] },
  data: { name: "content", options: [{ name: "help", type: 1 }] },
  ...over,
});

test("/content help answers privately, mentions nobody, and fits a message", async () => {
  const r: any = await createDispatch(deps)(help());
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
  assert.equal(r.data.content, HELP_TEXT);
  assert.ok(HELP_TEXT.length < 2000);
});

test("/content help is registered and names every command, so it cannot fall behind", () => {
  const names = commands[0]!.options.map((o) => o.name);
  assert.ok(names.includes("help"));
  for (const name of names) assert.ok(HELP_TEXT.includes(`/content ${name}`), `help mentions /content ${name}`);
});

test("help also works without a member (a direct message cannot reach it, but nothing breaks)", async () => {
  const r: any = await createDispatch(deps)(help({ member: undefined }));
  assert.equal(r.data.flags, 64);
});
