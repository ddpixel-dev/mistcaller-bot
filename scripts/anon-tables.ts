// Every table the anon role must be unable to reach through the Data API.
export const ANON_PROBE_TABLES = [
  "guild_settings",
  "content",
  "slot",
  "signup",
  "vote",
  "slot_preset",
  "slot_draft",
  "schema_migrations",
] as const;

// 401/403/404 mean the Data API refused the anon role; anything else (200, 5xx, 0) is not proof of denial.
export function classifyAnonStatus(status: number): "denied" | "exposed" {
  return status === 401 || status === 403 || status === 404 ? "denied" : "exposed";
}
