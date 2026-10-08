import type { Sql } from "./client.ts";
import { isVoteOpen, type VoteChoice } from "../domain/vote.ts";

export type CastVoteResult =
  | "recorded"
  | "changed"
  | "closed"
  | "not_signed"
  | "no_loot"
  | "unavailable"
  | "not_found";

export async function castVote(
  sql: Sql,
  a: { contentId: string; userId: string; guildId: string; choice: VoteChoice; now: Date },
): Promise<CastVoteResult> {
  return await sql.begin(async (tx): Promise<CastVoteResult> => {
    const [c] = await tx`
      select status, guild_id, has_loot, starts_at from content where id = ${a.contentId} for share`;
    if (!c || c.guild_id !== a.guildId) return "not_found";
    if (c.status !== "open" && c.status !== "locked") return "unavailable";
    if (!c.has_loot) return "no_loot";
    if (!isVoteOpen(c.starts_at, a.now)) return "closed";
    const [su] = await tx`
      select 1 as ok from signup
      where content_id = ${a.contentId} and user_id = ${a.userId} and status in ('signed', 'fill')`;
    if (!su) return "not_signed";

    const [prev] = await tx`
      select choice from vote where content_id = ${a.contentId} and user_id = ${a.userId} for update`;
    await tx`
      insert into vote (guild_id, content_id, user_id, choice, voted_at)
      values (${c.guild_id}, ${a.contentId}, ${a.userId}, ${a.choice}, ${a.now})
      on conflict (content_id, user_id)
      do update set choice = excluded.choice, voted_at = excluded.voted_at`;
    return prev && prev.choice !== a.choice ? "changed" : "recorded";
  });
}
