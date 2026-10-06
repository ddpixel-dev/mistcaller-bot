import { handleDiscordRequest } from "../src/http/discord-handler.ts";
import { reply } from "../src/discord/response.ts";

export async function POST(request: Request): Promise<Response> {
  return handleDiscordRequest(request, {
    publicKey: process.env.DISCORD_PUBLIC_KEY ?? "",
    dispatch: async () => reply("Not implemented yet"),
  });
}
