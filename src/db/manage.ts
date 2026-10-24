import type { Sql } from "./client.ts";
import { planSlotEdit } from "../domain/slots.ts";
import { promoteWaitlist, type Promotion } from "./signup.ts";
import { needsReminder } from "../domain/vote.ts";
import type { ContentStatus, RosterSlot, SlotDef } from "../domain/types.ts";

export type ManageTarget = {
  id: string;
  guildId: string;
  threadId: string;
  messageId: string | null;
  status: ContentStatus;
  createdBy: string | null;
};

const target = (r: Record<string, any>): ManageTarget => ({
  id: r.id,
  guildId: r.guild_id,
  threadId: r.thread_id,
  messageId: r.message_id,
  status: r.status as ContentStatus,
  createdBy: r.created_by,
});

export async function getManageTarget(sql: Sql, guildId: string, threadId: string): Promise<ManageTarget | null> {
  const [r] = await sql`
    select id, guild_id, thread_id, message_id, status, created_by from content
    where guild_id = ${guildId} and thread_id = ${threadId} and status <> 'cancelled'`;
  return r ? target(r) : null;
}

export async function getManageTargetById(sql: Sql, id: string): Promise<ManageTarget | null> {
  const [r] = await sql`
    select id, guild_id, thread_id, message_id, status, created_by from content where id = ${id}`;
  return r ? target(r) : null;
}

export type EditInput = {
  title: string;
  notes: string | null;
  startsAt: Date;
  tier: string;
  hasLoot: boolean | null; // null keeps the current value
  kind: string | null; // null keeps the current value
  buildRef?: string | null; // undefined keeps the current value, null removes it
  slots: SlotDef[];
};

export type EditResult =
  | { result: "ok"; startChanged: boolean; notify: string[]; promoted: Promotion[] }
  | { result: "unavailable" }
  | { result: "slots_held"; error: string };

export async function editContent(sql: Sql, id: string, input: EditInput, now: Date): Promise<EditResult> {
  return await sql.begin(async (tx): Promise<EditResult> => {
    const [c] = await tx`select status, starts_at, has_loot, kind, build_channel_id from content where id = ${id} for update`;
    if (!c || c.status !== "open") return { result: "unavailable" };

    const slotRows = await tx`
      select s.id, s.position, s.role, s.weapon, s.duty, su.user_id
      from slot s left join signup su on su.slot_id = s.id and su.status = 'signed'
      where s.content_id = ${id} order by s.position`;
    const current: RosterSlot[] = slotRows.map((s) => ({
      id: s.id, position: s.position, role: s.role, weapon: s.weapon ?? "", duty: s.duty ?? null, userId: s.user_id ?? null,
    }));
    const plan = planSlotEdit(current, input.slots);
    if (!plan.ok) return { result: "slots_held", error: plan.error };

    for (const r of plan.value.rename) {
      await tx`update slot set role = ${r.role}, weapon = ${r.weapon || null}, duty = ${r.duty} where id = ${r.id}`;
    }
    for (const sid of plan.value.remove) {
      await tx`delete from slot where id = ${sid}`;
    }
    if (plan.value.add.length > 0) {
      const [{ guild_id }] = await tx`select guild_id from content where id = ${id}`;
      const rows = plan.value.add.map((s, i) => ({
        guild_id,
        content_id: id,
        position: current.length + i + 1,
        role: s.role,
        weapon: s.weapon || null,
        duty: s.duty ?? null,
      }));
      await tx`insert into slot ${tx(rows, "guild_id", "content_id", "position", "role", "weapon", "duty")}`;
    }

    await tx`
      update content set
        title = ${input.title}, notes = ${input.notes}, starts_at = ${input.startsAt},
        gear_tier = ${input.tier},
        has_loot = ${input.hasLoot ?? c.has_loot}, kind = ${input.kind ?? c.kind},
        build_channel_id = ${input.buildRef === undefined ? c.build_channel_id : input.buildRef}
      where id = ${id}`;

    const startChanged = c.starts_at.getTime() !== input.startsAt.getTime();
    if (startChanged) {
      // A new start time resets the reminder (FR-009), unless the new start is already inside the lead time.
      await tx`update content set reminder_sent_at = ${needsReminder(input.startsAt, now) ? null : now} where id = ${id}`;
    }
    const notify = startChanged
      ? (await tx`select user_id from signup where content_id = ${id} and status in ('signed', 'fill') order by joined_at`).map(
          (r) => r.user_id as string,
        )
      : [];
    // New or renamed positions may suit members waiting for that role.
    const promoted = await promoteWaitlist(tx, id, now);
    return { result: "ok", startChanged, notify, promoted };
  });
}

export type CancelResult = { result: "ok"; notify: string[] } | { result: "unavailable" };

export async function cancelContent(sql: Sql, id: string): Promise<CancelResult> {
  return await sql.begin(async (tx): Promise<CancelResult> => {
    const [c] = await tx`select status from content where id = ${id} for update`;
    if (!c || (c.status !== "open" && c.status !== "locked")) return { result: "unavailable" };
    await tx`update content set status = 'cancelled' where id = ${id}`;
    const rows = await tx`select user_id from signup where content_id = ${id} and status in ('signed', 'fill') order by joined_at`;
    return { result: "ok", notify: rows.map((r) => r.user_id as string) };
  });
}

export type SettingsResult = "ok" | "unavailable";

// The Edit panel (ADR 0029): the category, the loot vote and the build reference, each on its own, while open.
// A field left out keeps its value; buildRef null removes the reference.
export async function updateContentSettings(
  sql: Sql, id: string, s: { kind?: string; hasLoot?: boolean; buildRef?: string | null },
): Promise<SettingsResult> {
  return await sql.begin(async (tx): Promise<SettingsResult> => {
    const [c] = await tx`select status, kind, has_loot, build_channel_id from content where id = ${id} for update`;
    if (!c || c.status !== "open") return "unavailable";
    await tx`
      update content set kind = ${s.kind ?? c.kind}, has_loot = ${s.hasLoot ?? c.has_loot},
        build_channel_id = ${s.buildRef === undefined ? c.build_channel_id : s.buildRef}
      where id = ${id}`;
    return "ok";
  });
}

export type WeaponResult = { result: "ok"; holder: string | null; replaced: string | null } | { result: "has_weapon" | "no_slot" | "unavailable" };

// Set weapon (ADR 0029): the host gives a role-only position its weapon. The holder keeps the seat; their own pick
// (FR-030) is replaced, and returned so the post can tell them. Allowed while open or locked.
export async function setSlotWeapon(sql: Sql, a: { contentId: string; position: number; weapon: string }): Promise<WeaponResult> {
  return await sql.begin(async (tx): Promise<WeaponResult> => {
    const [c] = await tx`select status from content where id = ${a.contentId} for update`;
    if (!c || (c.status !== "open" && c.status !== "locked")) return { result: "unavailable" };
    const [slot] = await tx`select id, weapon from slot where content_id = ${a.contentId} and position = ${a.position}`;
    if (!slot) return { result: "no_slot" };
    if (slot.weapon) return { result: "has_weapon" };
    await tx`update slot set weapon = ${a.weapon} where id = ${slot.id}`;
    const [holder] = await tx`
      select user_id, chosen_weapon from signup where slot_id = ${slot.id} and status = 'signed'`;
    if (holder) await tx`update signup set chosen_weapon = null where content_id = ${a.contentId} and user_id = ${holder.user_id}`;
    return { result: "ok", holder: holder?.user_id ?? null, replaced: holder?.chosen_weapon ?? null };
  });
}

export type DutyResult = "ok" | "no_slot" | "unavailable";

// The duty belongs to the position, held or open. Locked content can still be changed.
export async function setSlotDuty(
  sql: Sql,
  a: { contentId: string; position: number; duty: string | null },
): Promise<DutyResult> {
  return await sql.begin(async (tx): Promise<DutyResult> => {
    const [c] = await tx`select status from content where id = ${a.contentId} for update`;
    if (!c || (c.status !== "open" && c.status !== "locked")) return "unavailable";
    const [slot] = await tx`
      select s.id from slot s where s.content_id = ${a.contentId} and s.position = ${a.position}`;
    if (!slot) return "no_slot";
    await tx`update slot set duty = ${a.duty} where id = ${slot.id}`;
    return "ok";
  });
}

export type LockResult = "ok" | "unavailable";

// A manager closes signups. Players can still leave. The start does not lock a roster any more.
export async function lockContent(sql: Sql, contentId: string): Promise<LockResult> {
  return await sql.begin(async (tx): Promise<LockResult> => {
    const [c] = await tx`select status from content where id = ${contentId} for update`;
    if (!c || c.status !== "open") return "unavailable";
    await tx`update content set status = 'locked' where id = ${contentId}`;
    return "ok";
  });
}

export type UnlockResult = { result: "ok"; promoted: Promotion[] } | { result: "unavailable" };

// A manager reopens a locked roster. Positions freed while it was locked had no promotion then, so the
// waitlist is served now.
export async function unlockContent(sql: Sql, contentId: string, now: Date): Promise<UnlockResult> {
  return await sql.begin(async (tx): Promise<UnlockResult> => {
    const [c] = await tx`select status from content where id = ${contentId} for update`;
    if (!c || c.status !== "locked") return { result: "unavailable" };
    await tx`update content set status = 'open' where id = ${contentId}`;
    return { result: "ok", promoted: await promoteWaitlist(tx, contentId, now) };
  });
}

export type UpcomingItem = {
  id: string; threadId: string; messageId: string | null; title: string; type: string; kind: string;
  startsAt: Date; status: string; filled: number; total: number;
};

// FR-015: live content of the guild (open or locked, started or not, until it ends), soonest first.
export async function listUpcoming(sql: Sql, guildId: string, limit: number): Promise<UpcomingItem[]> {
  const rows = await sql`
    select c.id, c.thread_id, c.message_id, c.title, c.type, c.kind, c.starts_at, c.status,
      (select count(*)::int from signup su where su.content_id = c.id and su.status = 'signed')
        + least((select count(*)::int from signup su where su.content_id = c.id and su.status = 'fill'),
                (select count(*)::int from slot s where s.content_id = c.id)
                - (select count(*)::int from signup su where su.content_id = c.id and su.status = 'signed')) as filled,
      (select count(*)::int from slot s where s.content_id = c.id) as total
    from content c
    where c.guild_id = ${guildId} and c.status in ('open', 'locked')
    order by c.starts_at, c.id limit ${limit}`;
  return rows.map((r) => ({
    id: r.id, threadId: r.thread_id, messageId: r.message_id, title: r.title, type: r.type, kind: r.kind,
    startsAt: r.starts_at, status: r.status, filled: r.filled, total: r.total,
  }));
}
