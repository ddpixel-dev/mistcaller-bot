// One-off for release 0.30.0 (FR-057): fills made before it held a reserved seat and waited for the host. Seats each
// waiting fill in the best open position of its roster (healers first), as if a position had just freed up.
// Run once after the migration: docker compose run --rm node node scripts/seat-waiting-fills.ts
// Add --dry-run to see how many rosters would change without changing anything. Nothing is posted to Discord.
import { getSql } from "../src/db/client.ts";
import { promoteWaitlist } from "../src/db/signup.ts";

const dryRun = process.argv.includes("--dry-run");
const sql = getSql();
try {
  const rows = await sql`select distinct content_id from signup where status = 'fill' and content_id in (select id from content where status = 'open')`;
  let seated = 0;
  for (const r of rows) {
    if (dryRun) { console.log(`would check content ${r.content_id}`); continue; }
    const promoted = await sql.begin((tx) => promoteWaitlist(tx, r.content_id as string, new Date()));
    seated += promoted.length;
    if (promoted.length) console.log(`content ${r.content_id}: seated ${promoted.map((p) => `${p.userId} in ${p.position}`).join(", ")}`);
  }
  console.log(dryRun ? `${rows.length} open roster(s) have waiting fills` : `${seated} fill(s) seated on ${rows.length} roster(s)`);
} finally {
  await sql.end();
}
