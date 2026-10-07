import type { Sql } from "./client.ts";
import { planSlotEdit } from "../domain/slots.ts";
import type { ContentStatus, RosterSlot, SlotDef, TierRange } from "../domain/types.ts";

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
  tier: TierRange;
  hasLoot: boolean | null; // null keeps the current value
  kind: string | null; // null keeps the current value
  slots: SlotDef[];
};

export type EditResult =
  | { result: "ok"; startChanged: boolean; notify: string[] }
  | { result: "unavailable" }
  | { result: "slots_held"; error: string };

export async function editContent(sql: Sql, id: string, input: EditInput, now: Date): Promise<EditResult> {
  return await sql.begin(async (tx): Promise<EditResult> => {
    const [c] = await tx`select status, starts_at, has_loot, kind from content where id = ${id} for update`;
    if (!c || c.status !== "open" || c.starts_at <= now) return { result: "unavailable" };

    const slotRows = await tx`
      select s.id, s.position, s.role, s.weapon, s.duty, su.user_id
      from slot s left join signup su on su.slot_id = s.id and su.status = 'signed'
      where s.content_id = ${id} order by s.position`;
    const current: RosterSlot[] = slotRows.map((s) => ({
      id: s.id, position: s.position, role: s.role, weapon: s.weapon, duty: s.duty ?? null, userId: s.user_id ?? null,
    }));
    const plan = planSlotEdit(current, input.slots);
    if (!plan.ok) return { result: "slots_held", error: plan.error };

    for (const r of plan.value.rename) {
      await tx`update slot set role = ${r.role}, weapon = ${r.weapon}, duty = ${r.duty} where id = ${r.id}`;
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
        weapon: s.weapon,
        duty: s.duty ?? null,
      }));
      await tx`insert into slot ${tx(rows, "guild_id", "content_id", "position", "role", "weapon", "duty")}`;
    }

    const { min, max } = input.tier;
    await tx`
      update content set
        title = ${input.title}, notes = ${input.notes}, starts_at = ${input.startsAt},
        min_tier = ${min.tier}, min_enchant = ${min.enchant},
        max_tier = ${max ? max.tier : null}, max_enchant = ${max ? max.enchant : null},
        has_loot = ${input.hasLoot ?? c.has_loot}, kind = ${input.kind ?? c.kind}
      where id = ${id}`;

    const startChanged = c.starts_at.getTime() !== input.startsAt.getTime();
    const notify = startChanged
      ? (await tx`select user_id from signup where content_id = ${id} and status = 'signed' order by joined_at`).map(
          (r) => r.user_id as string,
        )
      : [];
    return { result: "ok", startChanged, notify };
  });
}

export type CancelResult = { result: "ok"; notify: string[] } | { result: "unavailable" };

export async function cancelContent(sql: Sql, id: string): Promise<CancelResult> {
  return await sql.begin(async (tx): Promise<CancelResult> => {
    const [c] = await tx`select status from content where id = ${id} for update`;
    if (!c || (c.status !== "open" && c.status !== "locked")) return { result: "unavailable" };
    await tx`update content set status = 'cancelled' where id = ${id}`;
    const rows = await tx`select user_id from signup where content_id = ${id} and status = 'signed' order by joined_at`;
    return { result: "ok", notify: rows.map((r) => r.user_id as string) };
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
