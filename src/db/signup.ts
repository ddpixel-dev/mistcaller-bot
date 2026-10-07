import type { Sql } from "./client.ts";

export type Promotion = { userId: string; slotId: string; position: number; role: string; weapon: string };
export type WaitResult = "ok" | "already" | "signed" | "open_slot" | "unknown_role" | "locked" | "not_found";

type Tx = Parameters<Parameters<Sql["begin"]>[1]>[0];

// FR-007 (per role): every open position goes to the first member waiting for its role. Runs inside the
// transaction of the change that freed the position, so nobody can slip into it in between. Only while
// the content is open and before its start.
export async function promoteWaitlist(tx: Tx, contentId: string, now: Date): Promise<Promotion[]> {
  const [c] = await tx`select status, starts_at from content where id = ${contentId}`;
  if (!c || c.status !== "open" || c.starts_at <= now) return [];
  const open = await tx`
    select s.id, s.position, s.role, s.weapon from slot s
    left join signup su on su.slot_id = s.id and su.status = 'signed'
    where s.content_id = ${contentId} and su.user_id is null order by s.position`;
  const out: Promotion[] = [];
  for (const slot of open) {
    const [w] = await tx`
      select user_id from signup
      where content_id = ${contentId} and status = 'waitlist' and lower(wait_role) = lower(${slot.role})
      order by joined_at, user_id limit 1 for update`;
    if (!w) continue;
    await tx`
      update signup set slot_id = ${slot.id}, status = 'signed', wait_role = null, joined_at = now()
      where content_id = ${contentId} and user_id = ${w.user_id}`;
    out.push({ userId: w.user_id, slotId: slot.id, position: slot.position, role: slot.role, weapon: slot.weapon });
  }
  return out;
}

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

type ClaimArgs = { contentId: string; slotId: string; userId: string; guildId: string; now: Date; promoted?: Promotion[] };

export async function claimSlot(sql: Sql, a: ClaimArgs): Promise<ClaimResult> {
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

async function claimOnce(sql: Sql, a: ClaimArgs): Promise<ClaimResult> {
  try {
    return await sql.begin(async (tx): Promise<ClaimResult> => {
      if (a.promoted) a.promoted.length = 0; // a retried attempt starts clean
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
        do update set slot_id = excluded.slot_id, status = 'signed', wait_role = null, joined_at = now()`;
      const moved = prev && prev.status === "signed";
      // Moving away frees a position, which goes to the first member waiting for that role.
      if (moved && a.promoted) a.promoted.push(...(await promoteWaitlist(tx, a.contentId, a.now)));
      return moved ? "moved" : "claimed";
    });
  } catch (err) {
    if (isSlotTaken(err)) return "taken";
    throw err;
  }
}

export async function leaveContent(
  sql: Sql,
  a: { contentId: string; userId: string; guildId?: string; slotId?: string; now?: Date; promoted?: Promotion[] },
): Promise<LeaveResult> {
  return await sql.begin(async (tx): Promise<LeaveResult> => {
    if (a.promoted) a.promoted.length = 0;
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
    if (a.now && a.promoted) a.promoted.push(...(await promoteWaitlist(tx, a.contentId, a.now)));
    return "left";
  });
}

// Join the waitlist for a role whose positions are all taken. A member who holds a position leaves it first.
export async function joinWaitlist(
  sql: Sql,
  a: { contentId: string; userId: string; guildId: string; role: string; now: Date },
): Promise<WaitResult> {
  return await sql.begin(async (tx): Promise<WaitResult> => {
    const [c] = await tx`select status, guild_id, starts_at from content where id = ${a.contentId} for share`;
    if (!c || c.guild_id !== a.guildId) return "not_found";
    if (c.status !== "open" || c.starts_at <= a.now) return "locked";
    const slots = await tx`
      select s.role, su.user_id from slot s
      left join signup su on su.slot_id = s.id and su.status = 'signed'
      where s.content_id = ${a.contentId} and lower(s.role) = lower(${a.role})`;
    if (slots.length === 0) return "unknown_role";
    if (slots.some((s) => s.user_id === null)) return "open_slot";
    const [prev] = await tx`
      select status, wait_role from signup where content_id = ${a.contentId} and user_id = ${a.userId} for update`;
    if (prev?.status === "signed") return "signed";
    if (prev?.status === "waitlist" && prev.wait_role?.toLowerCase() === a.role.toLowerCase()) return "already";
    const role = slots[0]!.role as string;
    await tx`
      insert into signup (guild_id, content_id, user_id, slot_id, status, wait_role)
      values (${a.guildId}, ${a.contentId}, ${a.userId}, null, 'waitlist', ${role})
      on conflict (content_id, user_id)
      do update set slot_id = null, status = 'waitlist', wait_role = excluded.wait_role, joined_at = now()`;
    return "ok";
  });
}
