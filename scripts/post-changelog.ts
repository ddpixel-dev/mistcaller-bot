// Posts the changelog of a release to every server that has set a changelog channel (FR-061).
// Read it first:   docker compose run --rm node node scripts/post-changelog.ts 0.29.0 --dry-run
// Then post it:    docker compose run --rm node node scripts/post-changelog.ts 0.29.0
// A version is posted once per server; running it again skips the servers that already have it.
import { readFile } from "node:fs/promises";
import { getSql } from "../src/db/client.ts";
import { markChangelogPosted, pendingChangelogTargets } from "../src/db/changelog.ts";
import { changelogMessage } from "../src/render/changelog.ts";
import { changelogFileName, changelogTitle, planChangelogPost, splitChangelog, type ChannelInfo } from "../src/domain/changelog.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const version = args.find((a) => !a.startsWith("--"));
if (!version) {
  console.error("Usage: node scripts/post-changelog.ts <version> [--dry-run]");
  process.exit(1);
}
const file = new URL(`../${changelogFileName(version)}`, import.meta.url);
const clean = version.replace(/^v/, "");
const markdown = await readFile(file, "utf8");
const parts = splitChangelog(markdown);
const title = changelogTitle(markdown, clean);
if (parts.length === 0) {
  console.error(`${changelogFileName(version)} is empty`);
  process.exit(1);
}

const { DISCORD_BOT_TOKEN } = process.env;
const headers = { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "Content-Type": "application/json", "User-Agent": "DiscordBot (content-roster-bot, 0.1.0)" };
const API = "https://discord.com/api/v10";
// Each part is a roster-style card (src/render/changelog.ts); the first one carries the title.
const card = (content: string, parts: string[]) => changelogMessage(content, content === parts[0]);

async function call(method: string, path: string, payload?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, { method, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return await res.json().catch(() => ({}));
}

// The channel's kind decides how it is posted: messages in a text channel, one post in a forum.
async function channelInfo(channelId: string): Promise<ChannelInfo | null> {
  if (!DISCORD_BOT_TOKEN) return null;
  try { return await call("GET", `/channels/${channelId}`); } catch { return null; }
}

const sql = getSql();
try {
  const targets = await pendingChangelogTargets(sql, clean);
  console.log(`${changelogFileName(version)}: ${parts.length} message(s), ${targets.length} server(s) waiting`);
  if (dryRun) {
    parts.forEach((p, i) => console.log(`\n----- message ${i + 1}/${parts.length} (${p.length} characters) -----\n${p}`));
    for (const t of targets) {
      const info = await channelInfo(t.channelId);
      const how = info?.type === 15 ? `a new forum post "${title}"` : info ? "messages" : "(channel kind unknown: no bot token here)";
      console.log(`\nwould post to channel ${t.channelId} of server ${t.guildId} as ${how}`);
    }
    console.log("\ndry run: nothing was posted");
  } else {
    if (!DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is required");
    for (const t of targets) {
      try {
        const info = await call("GET", `/channels/${t.channelId}`) as ChannelInfo;
        const plan = planChangelogPost(info, parts, title);
        if (plan.kind === "messages") {
          for (const content of plan.messages) await call("POST", `/channels/${t.channelId}/messages`, card(content, parts));
        } else {
          const post = await call("POST", `/channels/${t.channelId}/threads`, {
            name: plan.name, ...(plan.tags.length ? { applied_tags: plan.tags } : {}), message: card(plan.first, parts),
          }) as { id: string };
          for (const content of plan.replies) await call("POST", `/channels/${post.id}/messages`, card(content, parts));
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
