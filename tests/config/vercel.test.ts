import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Supabase is in eu-west-1; functions in another region break the 3 second limit (NFR-002, Q13).
test("vercel.json pins the functions next to the database in Dublin", async () => {
  const config = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(config.regions, ["dub1"]);
});
