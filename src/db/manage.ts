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
  slots: SlotDef[];
};

export type EditResult =
  | { result: "ok"; startChanged: boolean; notify: string[] }
  | { result: "unavailable" }
  | { result: "slots_held"; error: string };

export async function editContent(sql: Sql, id: string, input: EditInput, now: Date): Promise<EditResult> {
  return await sql.begin(async (tx): Promise<EditResult> => {
    const [c] = await tx`select status, starts_at, has_loot from content where id = ${id} for update`;
    if (!c || c.status !== "open" || c.starts_at <= now) return { result: "unavailable" };

    const slotRows = await tx`
      select s.id, s.position, s.role, s.weapon, su.user_id
      from slot s left join signup su on su.slot_id = s.id and su.status = 'signed'
      where s.content_id = ${id} order by s.position`;
    const current: RosterSlot[] = slotRows.map((s) => ({
      id: s.id, position: s.position, role: s.role, weapon: s.weapon, userId: s.user_id ?? null,
    }));
    const plan = planSlotEdit(current, input.slots);
    if (!plan.ok) return { result: "slots_held", error: plan.error };

    for (const r of plan.value.rename) {
      await tx`update slot set role = ${r.role}, weapon = ${r.weapon} where id = ${r.id}`;
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
      }));
      await tx`insert into slot ${tx(rows, "guild_id", "content_id", "position", "role", "weapon")}`;
    }

    const { min, max } = input.tier;
    await tx`
      update content set
        title = ${input.title}, notes = ${input.notes}, starts_at = ${input.startsAt},
        min_tier = ${min.tier}, min_enchant = ${min.enchant},
        max_tier = ${max ? max.tier : null}, max_enchant = ${max ? max.enchant : null},
        has_loot = ${input.hasLoot ?? c.has_loot}
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
