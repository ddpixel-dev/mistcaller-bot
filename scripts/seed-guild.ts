import { getSql } from "../src/db/client.ts";

const [guildId, pvpForumId, pveForumId] = process.argv.slice(2);
if (!guildId || !pvpForumId || !pveForumId) {
  console.error("usage: seed-guild.ts <guildId> <pvpForumId> <pveForumId>");
  process.exit(1);
}
const sql = getSql();
try {
  await sql`
    insert into guild_settings (guild_id, pvp_forum_id, pve_forum_id)
    values (${guildId}, ${pvpForumId}, ${pveForumId})
    on conflict (guild_id) do update
      set pvp_forum_id = excluded.pvp_forum_id, pve_forum_id = excluded.pve_forum_id`;
  console.log(`seeded guild ${guildId}`);
} finally {
  await sql.end();
}
