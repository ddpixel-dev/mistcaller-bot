import { buildClearGuildRequest, buildRegisterRequest } from "../src/discord/commands.ts";

// Registers the slash commands globally (ADR 0020). If DISCORD_GUILD_ID is still set, that server's own command list
// is emptied afterwards so the commands are not shown twice. The id is optional and can be removed once it is cleared.
const { DISCORD_APP_ID, DISCORD_GUILD_ID, DISCORD_BOT_TOKEN } = process.env;
if (!DISCORD_APP_ID || !DISCORD_BOT_TOKEN) {
  console.error("DISCORD_APP_ID and DISCORD_BOT_TOKEN are required");
  process.exit(1);
}
const req = buildRegisterRequest({ appId: DISCORD_APP_ID, token: DISCORD_BOT_TOKEN });
const res = await fetch(req.url, req.init);
if (!res.ok) {
  console.error(`register failed with status ${res.status}`);
  process.exit(1);
}
const registered = (await res.json()) as { name: string }[];
console.log(`registered globally: ${registered.map((c) => c.name).join(", ")}`);

if (DISCORD_GUILD_ID) {
  const clear = buildClearGuildRequest({ appId: DISCORD_APP_ID, guildId: DISCORD_GUILD_ID, token: DISCORD_BOT_TOKEN });
  const cleared = await fetch(clear.url, clear.init);
  console.log(cleared.ok ? `cleared the old commands of server ${DISCORD_GUILD_ID}` : `could not clear server ${DISCORD_GUILD_ID} (status ${cleared.status})`);
}
