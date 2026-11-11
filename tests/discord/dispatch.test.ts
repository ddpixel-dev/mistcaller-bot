import { test } from "node:test";
import assert from "node:assert/strict";
import { createDispatch, type Deps } from "../../src/discord/dispatch.ts";
import type { Interaction } from "../../src/discord/types.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const press = (customId: string): Interaction => ({
  id: "i", type: 3, application_id: "a", token: "t", guild_id: "g1",
  member: { user: { id: "u1" }, roles: [] }, data: { custom_id: customId, component_type: 2 },
});
// No handler reaches the database before it validates the id, so a deps object that throws on use is enough.
const deps = new Proxy({}, { get() { throw new Error("deps used"); } }) as unknown as Deps;

test("a party suffix is refused privately when it is not @1 or @2, and no handler runs", async () => {
  const d = createDispatch(deps);
  for (const suffix of ["@3", "@0", "@x", "@"]) {
    const r: any = await d(press(`tent:${ID}${suffix}`));
    assert.equal(r.type, 4, suffix);
    assert.equal(r.data.flags, 64);
    assert.equal(r.data.content, "This control is not valid");
  }
});

test("a party 2 button reaches its handler with the party set and the plain custom id", async () => {
  const seen: Interaction[] = [];
  const d = createDispatch({ ...(deps as object), sql: undefined, get rest() { return undefined; } } as unknown as Deps);
  const i = press(`tent:${ID}@2`);
  i.message = { id: "m", flags: 0 }; // old layout: the handler answers without touching the database
  const r: any = await d(i);
  seen.push(i);
  assert.ok(String(r.data.content).includes("older layout"));
  assert.equal(i.party, 2);
  assert.equal((i.data as any).custom_id, `tent:${ID}`);
});

test("a button without a suffix is party 1", async () => {
  const d = createDispatch({} as Deps);
  const i = press(`tent:${ID}`);
  i.message = { id: "m", flags: 0 };
  await d(i);
  assert.equal(i.party, 1);
});
