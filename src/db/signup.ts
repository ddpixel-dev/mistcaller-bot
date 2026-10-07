import type { Sql } from "./client.ts";

export type ClaimResult = "claimed" | "moved" | "unchanged" | "taken" | "locked" | "not_found";
export type LeaveResult = "left" | "not_signed" | "unavailable" | "not_found" | "not_yours";

function isSlotTaken(err: unknown): boolean {
  const e = err as { code?: string; constraint_name?: string } | null;
  return e?.code === "23505" && e.constraint_name === "signup_one_signed_per_slot";
}

function isRetryable(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "40P01" || code === "40001";
}

export async function claimSlot(
  sql: Sql,
  a: { contentId: string; slotId: string; userId: string; guildId: string; now: Date },
): Promise<ClaimResult> {
  try {
    return await claimOnce(sql, a);
  } catch (err) {
    if (!isRetryable(err)) throw err;
  }
  // Deadlock or serialization failure (e.g. two users swapping slots): retry once.
  try {
    return await claimOnce(sql, a);
  } catch (err) {
    if (isRetryable(err)) return "taken";
    throw err;
  }
}

async function claimOnce(
  sql: Sql,
  a: { contentId: string; slotId: string; userId: string; guildId: string; now: Date },
): Promise<ClaimResult> {
  try {
    return await sql.begin(async (tx): Promise<ClaimResult> => {
      const [c] = await tx`select status, guild_id, starts_at from content where id = ${a.contentId} for share`;
      if (!c || c.guild_id !== a.guildId) return "not_found";
      const [s] = await tx`select id from slot where id = ${a.slotId} and content_id = ${a.contentId}`;
      if (!s) return "not_found";
      if (c.status !== "open" || c.starts_at <= a.now) return "locked";

      const [prev] = await tx`
        select slot_id, status from signup
        where content_id = ${a.contentId} and user_id = ${a.userId} for update`;
      if (prev && prev.status === "signed" && prev.slot_id === a.slotId) return "unchanged";

      await tx`
        insert into signup (guild_id, content_id, user_id, slot_id, status)
        values (${a.guildId}, ${a.contentId}, ${a.userId}, ${a.slotId}, 'signed')
        on conflict (content_id, user_id)
        do update set slot_id = excluded.slot_id, status = 'signed', joined_at = now()`;
      return prev && prev.status === "signed" ? "moved" : "claimed";
    });
  } catch (err) {
    if (isSlotTaken(err)) return "taken";
    throw err;
  }
}

export async function leaveContent(
  sql: Sql,
  a: { contentId: string; userId: string; guildId?: string; slotId?: string },
): Promise<LeaveResult> {
  return await sql.begin(async (tx): Promise<LeaveResult> => {
    const [c] = await tx`select status, guild_id from content where id = ${a.contentId} for update`;
    if (c && a.guildId !== undefined && c.guild_id !== a.guildId) return "not_found";
    if (!c || (c.status !== "open" && c.status !== "locked")) return "unavailable";
    if (a.slotId !== undefined) {
      // A Leave button on a roster row only works for the member who holds that position.
      const [mine] = await tx`
        select slot_id from signup where content_id = ${a.contentId} and user_id = ${a.userId} and status = 'signed'`;
      if (!mine) return "not_signed";
      if (mine.slot_id !== a.slotId) return "not_yours";
    }
    const rows = await tx`
      delete from signup where content_id = ${a.contentId} and user_id = ${a.userId}
      returning user_id`;
    if (rows.length === 0) return "not_signed";
    await tx`delete from vote where content_id = ${a.contentId} and user_id = ${a.userId}`;
    return "left";
  });
}
