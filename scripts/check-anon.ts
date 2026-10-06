const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!base || !key) {
  console.error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
  process.exit(2);
}
const res = await fetch(`${base}/rest/v1/content?select=*`, {
  headers: { apikey: key, authorization: `Bearer ${key}` },
});
console.log(`anon request to content: status ${res.status}`);
if (![401, 403, 404].includes(res.status)) {
  console.error("FAIL: anon role can reach the content table");
  process.exit(1);
}
console.log("ok: anon access denied");
