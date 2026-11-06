// Posts the changelog of a release to every server that has set a changelog channel (FR-061).
// Read it first:   docker compose run --rm node node scripts/post-changelog.ts 0.29.0 --dry-run
// Then post it:    docker compose run --rm node node scripts/post-changelog.ts 0.29.0
// A version is posted once per server; running it again skips the servers that already have it.
import { readFile } from "node:fs/promises";
import { getSql } from "../src/db/client.ts";
import { markChangelogPosted, pendingChangelogTargets } from "../src/db/changelog.ts";
import { changelogFileName, splitChangelog } from "../src/domain/changelog.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const version = args.find((a) => !a.startsWith("--"));
if (!version) {
  console.error("Usage: node scripts/post-changelog.ts <version> [--dry-run]");
  process.exit(1);
}
const file = new URL(`../${changelogFileName(version)}`, import.meta.url);
const clean = version.replace(/^v/, "");
const parts = splitChangelog(await readFile(file, "utf8"));
if (parts.length === 0) {
  console.error(`${changelogFileName(version)} is empty`);
  process.exit(1);
}

const sql = getSql();
try {
  const targets = await pendingChangelogTargets(sql, clean);
  console.log(`${changelogFileName(version)}: ${parts.length} message(s), ${targets.length} server(s) waiting`);
  if (dryRun) {
    parts.forEach((p, i) => console.log(`\n----- message ${i + 1}/${parts.length} (${p.length} characters) -----\n${p}`));
    for (const t of targets) console.log(`\nwould post to channel ${t.channelId} of server ${t.guildId}`);
    console.log("\ndry run: nothing was posted");
  } else {
    const { DISCORD_BOT_TOKEN } = process.env;
    if (!DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is required");
    for (const t of targets) {
      try {
        for (const content of parts) {
          const res = await fetch(`https://discord.com/api/v10/channels/${t.channelId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "Content-Type": "application/json", "User-Agent": "DiscordBot (content-roster-bot, 0.1.0)" },
            body: JSON.stringify({ content, allowed_mentions: { parse: [] }, flags: 4 }), // 4: no link previews
          });
          if (!res.ok) throw new Error(`status ${res.status}`);
        }
        await markChangelogPosted(sql, t.guildId, clean, new Date());
        console.log(`posted to channel ${t.channelId} of server ${t.guildId}`);
      } catch (err) {
        // Not marked as posted, so running the script again retries this server (it may repeat the first messages).
        console.error(`FAILED for channel ${t.channelId} of server ${t.guildId}: ${err instanceof Error ? err.message : "error"}`);
        process.exitCode = 1;
      }
    }
  }
} finally {
  await sql.end();
}
