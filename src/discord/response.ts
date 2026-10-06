import type { InteractionResponse } from "./types.ts";

export const PONG = 1;
export const CHANNEL_MESSAGE = 4;
export const UPDATE_MESSAGE = 7;
export const MODAL = 9;
export const EPHEMERAL = 64;

export function reply(content: string): InteractionResponse {
  return {
    type: CHANNEL_MESSAGE,
    data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
  };
}
