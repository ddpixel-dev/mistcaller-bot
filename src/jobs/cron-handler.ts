import { isAuthorized } from "./cron.ts";

export type CronDeps = {
  secret: string | undefined;
  run: () => Promise<{ locked: number; resultsPosted: number }>;
};

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function handleCron(request: Request, deps: CronDeps): Promise<Response> {
  if (!deps.secret) {
    console.error(JSON.stringify({ evt: "config_error", missing: ["CRON_SECRET"] }));
    return json({ error: "server misconfigured" }, 500);
  }
  if (!isAuthorized(request.headers.get("authorization"), deps.secret)) {
    return json({ error: "unauthorized" }, 401);
  }
  try {
    return json(await deps.run(), 200);
  } catch (e) {
    console.error(JSON.stringify({ evt: "cron_failed", error: e instanceof Error ? e.name : "unknown" }));
    return json({ error: "job failed" }, 500);
  }
}
