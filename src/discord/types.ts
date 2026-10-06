export interface Interaction {
  id: string;
  type: number;
  application_id: string;
  token: string;
  guild_id?: string;
  channel_id?: string;
  channel?: { id: string; type: number; parent_id?: string };
  member?: { user: { id: string }; permissions?: string; roles: string[] };
  data?: unknown;
}

export type InteractionResponse = { type: number; data?: unknown };

export type Dispatch = (i: Interaction) => Promise<InteractionResponse>;
