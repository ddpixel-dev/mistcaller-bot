import { handleCron } from "../src/jobs/cron-handler.ts";
import { runJobs } from "../src/jobs/cron.ts";
import { createRest } from "../src/discord/rest.ts";
import { getSql } from "../src/db/client.ts";
import type { Deps } from "../src/discord/dispatch.ts";

const REQUIRED = ["CRON_SECRET", "DISCORD_BOT_TOKEN", "DATABASE_URL"] as const;

let deps: Deps | undefined;

async function handle(request: Request): Promise<Response> {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(JSON.stringify({ evt: "config_error", missing }));
    return new Response(JSON.stringify({ error: "server misconfigured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  return handleCron(request, {
    secret: process.env.CRON_SECRET,
    run: () => {
      deps ??= {
        sql: getSql(),
        rest: createRest(process.env.DISCORD_BOT_TOKEN!),
        now: () => new Date(),
      };
      return runJobs(deps);
    },
  });
}

export const GET = handle;
export const POST = handle;
