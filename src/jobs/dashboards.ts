import { createHash } from "node:crypto";
import type { Deps } from "../discord/dispatch.ts";
import { DiscordApiError } from "../discord/rest.ts";
import { listDashboards, type DashboardKind } from "../db/dashboard.ts";
import { listSchedule } from "../db/schedule.ts";
import { renderSchedule } from "../render/schedule.ts";

// FR-043: the bot keeps one message per page of a dashboard in the channel an admin chose. It edits and deletes
// only the messages it posted itself and recorded. Nothing runs inside the 3-second reply except a short, guarded refresh.
export type RefreshResult = "updated" | "unchanged" | "none" | "failed";

const hash = (bodies: unknown[]) => createHash("sha1").update(JSON.stringify(bodies)).digest("hex");
const isMissing = (e: unknown) => e instanceof DiscordApiError && (e.status === 404 || e.code === 10008);

async function build(deps: Deps, guildId: string, kind: DashboardKind, stamp: Date): Promise<unknown[]> {
  return renderSchedule(await listSchedule(deps.sql, guildId, deps.now()), guildId, deps.now(), stamp);
}

export async function refreshDashboard(deps: Deps, guildId: string, kind: DashboardKind, opts: { touch?: boolean } = {}): Promise<RefreshResult> {
  // The dashboard row is locked for the whole refresh, so two refreshes at once cannot post a message twice.
  return await deps.sql.begin(async (tx): Promise<RefreshResult> => {
    const [row] = await tx`select channel_id, message_ids, digest from dashboard where guild_id = ${guildId} and kind = ${kind} for update`;
    if (!row) return "none";
    const channelId = row.channel_id as string;
    const old = (row.message_ids as string[]) ?? [];
    const now = deps.now();
    // The "Updated" time is left out of the digest, so only a real change edits the message.
    const digest = hash(await build(deps, guildId, kind, new Date(0)));
    const save = (messageIds: string[]) => tx`
      update dashboard set message_ids = ${tx.json(messageIds)}, digest = ${digest}, updated_at = ${now} where guild_id = ${guildId} and kind = ${kind}`;
    if (digest === row.digest && old.length > 0) {
      if (opts.touch) await save(old);
      return "unchanged";
    }
    const bodies = await build(deps, guildId, kind, now);
    const ids: string[] = [];
    try {
      for (const [n, body] of bodies.entries()) {
        const existing = old[n];
        if (existing) {
          try {
            await deps.rest.editMessage(channelId, existing, body);
            ids.push(existing);
            continue;
          } catch (e) {
            if (!isMissing(e)) throw e;
          }
        }
        ids.push((await deps.rest.createMessage(channelId, body)).id);
      }
      for (const extra of old.slice(bodies.length)) {
        await deps.rest.deleteMessage(channelId, extra).catch((e) => { if (!isMissing(e)) throw e; });
      }
    } catch (e) {
      console.error(JSON.stringify({ evt: "dashboard_failed", kind, name: e instanceof Error ? e.name : "unknown", status: e instanceof DiscordApiError ? e.status : undefined }));
      return "failed";
    }
    await save(ids);
    return "updated";
  });
}

// After a command that changes the schedule: best effort, and never longer than `limitMs` (the reply has 3 seconds).
export async function refreshDashboardSoon(deps: Deps, guildId: string, kind: DashboardKind, limitMs = 1500): Promise<void> {
  try {
    await Promise.race([refreshDashboard(deps, guildId, kind), new Promise((r) => setTimeout(r, limitMs))]);
  } catch (e) {
    console.error(JSON.stringify({ evt: "dashboard_failed", kind, name: e instanceof Error ? e.name : "unknown" }));
  }
}

// The scheduled job: every server's calendar (the digest keeps unchanged ones free). Returns how many changed.
export async function refreshAllDashboards(deps: Deps): Promise<number> {
  let changed = 0;
  for (const d of await listDashboards(deps.sql, "schedule")) {
    if ((await refreshDashboard(deps, d.guildId, "schedule").catch(() => "failed")) === "updated") changed++;
  }
  return changed;
}
