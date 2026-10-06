import { buildRegisterRequest } from "../src/discord/commands.ts";

const { DISCORD_APP_ID, DISCORD_GUILD_ID, DISCORD_BOT_TOKEN } = process.env;
if (!DISCORD_APP_ID || !DISCORD_GUILD_ID || !DISCORD_BOT_TOKEN) {
  console.error("DISCORD_APP_ID, DISCORD_GUILD_ID and DISCORD_BOT_TOKEN are required");
  process.exit(1);
}
const req = buildRegisterRequest({ appId: DISCORD_APP_ID, guildId: DISCORD_GUILD_ID, token: DISCORD_BOT_TOKEN });
const res = await fetch(req.url, req.init);
if (!res.ok) {
  console.error(`register failed with status ${res.status}`);
  process.exit(1);
}
const registered = (await res.json()) as { name: string }[];
console.log(`registered: ${registered.map((c) => c.name).join(", ")}`);
