// Every table the anon role must be unable to reach through the Data API.
export const ANON_PROBE_TABLES = [
  "guild_settings",
  "content",
  "slot",
  "signup",
  "vote",
  "schema_migrations",
] as const;
