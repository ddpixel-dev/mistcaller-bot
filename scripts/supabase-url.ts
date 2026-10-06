// Reduce SUPABASE_URL to its origin. Errors never include the raw value
// (it may carry a key in the query string).
export function normalizeSupabaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("SUPABASE_URL is not a valid URL. Expected https://<ref>.supabase.co");
  }
  const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error(`SUPABASE_URL must use https (http is allowed only for localhost), got scheme "${url.protocol}"`);
  }
  return url.origin;
}
