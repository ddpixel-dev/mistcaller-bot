// One-off for release 0.31.0 (ADR 0036): event forums no longer have a pinned "Create an event" launcher post, because
// content is created with the buttons in the content-management channel. This deletes the launcher posts the bot made
// and forgets them. Safe to run again.
// Look first: docker compose run --rm node node scripts/remove-launchers.ts --dry-run
// Then:       docker compose run --rm node node scripts/remove-launchers.ts
import { getSql } from "../src/db/client.ts";

const dryRun = process.argv.includes("--dry-run");
const { DISCORD_BOT_TOKEN } = process.env;
const sql = getSql();
try {
  const rows = await sql`select guild_id, forum_id, launcher_thread_id from event_forum where launcher_thread_id is not null`;
  console.log(`${rows.length} launcher post(s)`);
  for (const r of rows) {
    if (dryRun) { console.log(`would delete post ${r.launcher_thread_id} in forum ${r.forum_id} of server ${r.guild_id}`); continue; }
    if (!DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is required");
    const res = await fetch(`https://discord.com/api/v10/channels/${r.launcher_thread_id}`, {
      method: "DELETE", headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "User-Agent": "DiscordBot (content-roster-bot, 0.1.0)" },
    });
    // 404: already gone. Anything else leaves the row, so running the script again retries it.
    if (res.ok || res.status === 404) {
      await sql`update event_forum set launcher_thread_id = null where guild_id = ${r.guild_id} and forum_id = ${r.forum_id}`;
      console.log(`removed ${r.launcher_thread_id}${res.status === 404 ? " (it was already gone)" : ""}`);
    } else {
      console.error(`FAILED for ${r.launcher_thread_id}: status ${res.status}`);
      process.exitCode = 1;
    }
  }
} finally {
  await sql.end();
}
