import { ANON_PROBE_TABLES, classifyAnonStatus } from "./anon-tables.ts";
import { normalizeSupabaseUrl } from "./supabase-url.ts";

const rawUrl = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY?.trim();
if (!rawUrl || !key) {
  console.error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
  process.exit(2);
}
let origin: string;
try {
  origin = normalizeSupabaseUrl(rawUrl);
} catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}

// Positive control: a wrong URL or key also yields 404/401 on tables, which would look like "denied".
let controlStatus = 0;
try {
  controlStatus = (await fetch(`${origin}/auth/v1/health`, { headers: { apikey: key } })).status;
} catch {
  // leave controlStatus at 0
}
if (controlStatus !== 200) {
  console.error(
    `FAIL: positive control GET /auth/v1/health returned ${controlStatus || "no response"}. ` +
      "SUPABASE_URL/SUPABASE_ANON_KEY do not look like a valid Supabase project. " +
      "The URL must be https://<ref>.supabase.co with no path.",
  );
  process.exit(3);
}
console.log(`positive control ok: ${origin} answers /auth/v1/health`);

let failed = false;
for (const table of ANON_PROBE_TABLES) {
  try {
    const res = await fetch(`${origin}/rest/v1/${table}?select=*`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    let code = "";
    try {
      const body: unknown = await res.json();
      const c = (body as { code?: unknown } | null)?.code;
      if (typeof c === "string" && /^[A-Za-z0-9_]{1,16}$/.test(c)) code = c;
    } catch {
      // body is not JSON; nothing to report
    }
    const verdict = classifyAnonStatus(res.status);
    console.log(`anon request to ${table}: status ${res.status}${code ? ` code ${code}` : ""}${verdict === "denied" ? "" : " (FAIL)"}`);
    if (verdict === "exposed") failed = true;
  } catch {
    console.log(`anon request to ${table}: request failed (FAIL)`);
    failed = true;
  }
}
if (failed) {
  console.error("FAIL: anon role can reach at least one table, or a probe failed");
  process.exit(1);
}
console.log("ok: anon access denied on every table");
