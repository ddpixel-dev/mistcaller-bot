import { ANON_PROBE_TABLES } from "./anon-tables.ts";

const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!base || !key) {
  console.error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
  process.exit(2);
}
let failed = false;
for (const table of ANON_PROBE_TABLES) {
  const res = await fetch(`${base}/rest/v1/${table}?select=*`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  const denied = [401, 403, 404].includes(res.status);
  console.log(`anon request to ${table}: status ${res.status}${denied ? "" : " (FAIL)"}`);
  if (!denied) failed = true;
}
if (failed) {
  console.error("FAIL: anon role can reach at least one table");
  process.exit(1);
}
console.log("ok: anon access denied on every table");
