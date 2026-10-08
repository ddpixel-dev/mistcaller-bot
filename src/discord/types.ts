export interface Interaction {
  id: string;
  type: number;
  application_id: string;
  token: string;
  guild_id?: string;
  channel_id?: string;
  channel?: { id: string; type: number; parent_id?: string };
  member?: { user: { id: string }; permissions?: string; roles: string[] };
  user?: { id: string };
  // What the bot may do where the interaction happened (a permission bit set), and where the app is installed:
  // key "0" is a server install, "1" a user install.
  app_permissions?: string;
  authorizing_integration_owners?: Record<string, string>;
  data?: unknown;
  message?: { id: string; flags?: number };
}

export type InteractionResponse = { type: number; data?: unknown };

export type Dispatch = (i: Interaction) => Promise<InteractionResponse>;
