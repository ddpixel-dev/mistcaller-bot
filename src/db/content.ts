import type { Sql } from "./client.ts";
import type { ContentStatus, ContentType, RosterView, SlotDef, TierRange } from "../domain/types.ts";

export type NewContent = {
  guildId: string;
  threadId: string;
  type: ContentType;
  title: string;
  notes: string | null;
  startsAt: Date;
  tier: TierRange;
  hasLoot: boolean;
  createdBy: string;
  slots: SlotDef[];
};

export async function createContent(sql: Sql, input: NewContent): Promise<string> {
  return await sql.begin(async (tx) => {
    const { min, max } = input.tier;
    const [row] = await tx`
      insert into content (guild_id, thread_id, type, title, notes, starts_at,
        min_tier, min_enchant, max_tier, max_enchant, has_loot, created_by)
      values (${input.guildId}, ${input.threadId}, ${input.type}, ${input.title}, ${input.notes},
        ${input.startsAt}, ${min.tier}, ${min.enchant}, ${max ? max.tier : null},
        ${max ? max.enchant : null}, ${input.hasLoot}, ${input.createdBy})
      returning id`;
    const id: string = row!.id;
    for (let i = 0; i < input.slots.length; i++) {
      const s = input.slots[i]!;
      await tx`
        insert into slot (guild_id, content_id, position, role, weapon)
        values (${input.guildId}, ${id}, ${i + 1}, ${s.role}, ${s.weapon})`;
    }
    return id;
  });
}

export async function setMessageId(sql: Sql, contentId: string, messageId: string): Promise<void> {
  await sql`update content set message_id = ${messageId} where id = ${contentId}`;
}

export async function deleteContent(sql: Sql, contentId: string): Promise<void> {
  await sql`delete from content where id = ${contentId}`;
}

export async function getRosterView(sql: Sql, contentId: string, _now: Date): Promise<RosterView | null> {
  const rows = await sql`select * from content where id = ${contentId}`;
  const c = rows[0];
  if (!c) return null;
  const slots = await sql`
    select s.id, s.position, s.role, s.weapon, su.user_id
    from slot s
    left join signup su on su.slot_id = s.id and su.status = 'signed'
    where s.content_id = ${contentId}
    order by s.position`;
  return {
    id: c.id,
    guildId: c.guild_id,
    threadId: c.thread_id,
    messageId: c.message_id,
    type: c.type as ContentType,
    title: c.title,
    notes: c.notes,
    startsAt: c.starts_at,
    tier: {
      min: { tier: c.min_tier, enchant: c.min_enchant },
      max: c.max_tier === null ? null : { tier: c.max_tier, enchant: c.max_enchant },
    },
    hasLoot: c.has_loot,
    status: c.status as ContentStatus,
    slots: slots.map((s) => ({
      id: s.id,
      position: s.position,
      role: s.role,
      weapon: s.weapon,
      userId: s.user_id ?? null,
    })),
    votes: { split: 0, regear: 0 },
    voteClosed: false,
    voteResult: null,
  };
}
