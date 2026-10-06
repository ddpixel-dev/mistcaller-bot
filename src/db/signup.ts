import type { Sql } from "./client.ts";

export type ClaimResult = "claimed" | "moved" | "unchanged" | "taken" | "locked" | "not_found";
export type LeaveResult = "left" | "not_signed" | "unavailable";

function isSlotTaken(err: unknown): boolean {
  const e = err as { code?: string; constraint_name?: string } | null;
  return e?.code === "23505" && e.constraint_name === "signup_one_signed_per_slot";
}

export async function claimSlot(
  sql: Sql,
  a: { contentId: string; slotId: string; userId: string; guildId: string },
): Promise<ClaimResult> {
  try {
    return await sql.begin(async (tx): Promise<ClaimResult> => {
      const [c] = await tx`select status, guild_id from content where id = ${a.contentId}`;
      if (!c || c.guild_id !== a.guildId) return "not_found";
      const [s] = await tx`select id from slot where id = ${a.slotId} and content_id = ${a.contentId}`;
      if (!s) return "not_found";
      if (c.status !== "open") return "locked";

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
  a: { contentId: string; userId: string },
): Promise<LeaveResult> {
  return await sql.begin(async (tx): Promise<LeaveResult> => {
    const [c] = await tx`select status from content where id = ${a.contentId} for update`;
    if (!c || (c.status !== "open" && c.status !== "locked")) return "unavailable";
    const rows = await tx`
      delete from signup where content_id = ${a.contentId} and user_id = ${a.userId}
      returning user_id`;
    return rows.length > 0 ? "left" : "not_signed";
  });
}
