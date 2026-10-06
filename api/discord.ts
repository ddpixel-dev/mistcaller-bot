import { handleDiscordRequest } from "../src/http/discord-handler.ts";
import { createDispatch } from "../src/discord/dispatch.ts";
import { createRest } from "../src/discord/rest.ts";
import { getSql } from "../src/db/client.ts";
import type { Dispatch } from "../src/discord/types.ts";

const REQUIRED = ["DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN", "DATABASE_URL"] as const;

let dispatch: Dispatch | undefined;

export async function POST(request: Request): Promise<Response> {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(JSON.stringify({ evt: "config_error", missing }));
    return new Response("server misconfigured", { status: 500 });
  }
  dispatch ??= createDispatch({
    sql: getSql(),
    rest: createRest(process.env.DISCORD_BOT_TOKEN!),
    now: () => new Date(),
  });
  return handleDiscordRequest(request, { publicKey: process.env.DISCORD_PUBLIC_KEY!.trim(), dispatch });
}
