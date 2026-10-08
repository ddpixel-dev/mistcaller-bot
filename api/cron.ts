import { handleCron } from "../src/jobs/cron-handler.ts";
import { runJobs } from "../src/jobs/cron.ts";
import { createRest } from "../src/discord/rest.ts";
import { getSql } from "../src/db/client.ts";
import type { Deps } from "../src/discord/dispatch.ts";

const REQUIRED = ["DISCORD_BOT_TOKEN", "DATABASE_URL"] as const;

let deps: Deps | undefined;

// Only called after the request is authorized.
function buildDeps(): Deps {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(JSON.stringify({ evt: "config_error", missing }));
    const e = new Error("server misconfigured");
    e.name = "ConfigError";
    throw e;
  }
  deps ??= {
    sql: getSql(),
    rest: createRest(process.env.DISCORD_BOT_TOKEN!),
    now: () => new Date(),
  };
  return deps;
}

function handle(request: Request): Promise<Response> {
  return handleCron(request, {
    secret: process.env.CRON_SECRET,
    run: () => runJobs(buildDeps(), { autoReminders: process.env.AUTO_REMINDERS === "on" }),
  });
}

export const GET = handle;
export const POST = handle;
