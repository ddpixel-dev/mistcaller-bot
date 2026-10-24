import type { Sql } from "./client.ts";
import { type GuidedDraft } from "../domain/guided.ts";
import type { ContentType, SlotDef } from "../domain/types.ts";

export const DRAFT_TTL_MS = 60 * 60 * 1000;

// The creation card's state (ADR 0032): the choices, the text typed in Details, and the guided cards' progress.
// The type stays empty until chosen. `targetForumId` is set when the card was opened from an event forum's launcher.
export type CardFields = {
  type: ContentType | null;
  kind: string;
  loot: boolean;
  title: string | null;
  startText: string | null;
  gearTier: string | null;
  notes: string | null;
  slotsText: string | null;
};

export type StoredDraft = GuidedDraft & {
  id: string;
  guildId: string;
  userId: string;
  threadId: string;
  type: ContentType | null;
  loot: boolean;
  kind: string;
  buildRef: string | null;
  weaponClass: string | null;
  gearTier: string | null;
  title: string | null;
  startText: string | null;
  notes: string | null;
  slotsText: string | null;
  targetForumId: string | null;
};

const toDraft = (r: Record<string, any>): StoredDraft => ({
  id: r.id,
  guildId: r.guild_id,
  userId: r.user_id,
  threadId: r.thread_id,
  type: r.type === "pvp" || r.type === "pve" || r.type === "pvx" ? r.type : null,
  buildRef: r.build_channel_id ?? null,
  loot: r.loot,
  kind: r.kind,
  count: r.count ?? null,
  slots: r.slots as SlotDef[],
  step: r.step ?? 0,
  role: r.role ?? null,
  weapon: r.weapon ?? null,
  duty: r.duty ?? null,
  weaponClass: r.weapon_class ?? null,
  gearTier: r.gear_tier ?? null,
  title: r.title ?? null,
  startText: r.start_text ?? null,
  notes: r.notes ?? null,
  slotsText: r.slots_text ?? null,
  targetForumId: r.target_forum_id ?? null,
});

// One draft per member per place: opening the creation card again starts over.
export async function startCard(
  sql: Sql,
  a: { guildId: string; userId: string; threadId: string; type: ContentType | null; title: string | null; startText: string; targetForumId?: string | null },
): Promise<string> {
  const [row] = await sql`
    insert into slot_draft (guild_id, user_id, thread_id, type, loot, kind, slots, title, start_text, target_forum_id)
    values (${a.guildId}, ${a.userId}, ${a.threadId}, ${a.type}, false, 'other', '[]'::jsonb, ${a.title}, ${a.startText}, ${a.targetForumId ?? null})
    on conflict (guild_id, thread_id, user_id) do update set
      type = excluded.type, loot = false, kind = 'other', build_channel_id = null, count = null, counts = null, slots = '[]'::jsonb,
      step = 0, role = null, weapon = null, duty = null, query = null, weapon_class = null, gear_tier = null, title = excluded.title,
      start_text = excluded.start_text, notes = null, slots_text = null, target_forum_id = excluded.target_forum_id, created_at = now()
    returning id`;
  return row!.id;
}

// The card's menus and the Details form change these fields; anything left out keeps its value.
export async function saveCard(sql: Sql, id: string, f: Partial<CardFields> & { slots?: SlotDef[]; buildRef?: string | null }): Promise<void> {
  const [c] = await sql`select * from slot_draft where id = ${id}`;
  if (!c) return;
  const pick = <T>(v: T | undefined, old: T) => (v === undefined ? old : v);
  const slots = f.slots;
  await sql`
    update slot_draft set
      type = ${pick(f.type, c.type)}, kind = ${pick(f.kind, c.kind)}, loot = ${pick(f.loot, c.loot)}, title = ${pick(f.title, c.title)},
      start_text = ${pick(f.startText, c.start_text)}, gear_tier = ${pick(f.gearTier, c.gear_tier)}, notes = ${pick(f.notes, c.notes)},
      slots_text = ${pick(f.slotsText, c.slots_text)}, build_channel_id = ${pick(f.buildRef, c.build_channel_id)},
      slots = ${slots ? sql.json(slots as never) : c.slots}, count = ${slots ? slots.length || null : c.count}, step = ${slots ? slots.length : c.step},
      role = ${slots ? null : c.role}, weapon = ${slots ? null : c.weapon}, duty = ${slots ? null : c.duty}, weapon_class = ${slots ? null : c.weapon_class}
    where id = ${id}`;
}

export async function getDraft(sql: Sql, id: string, now: Date): Promise<StoredDraft | null> {
  const [r] = await sql`
    select * from slot_draft where id = ${id} and created_at > ${new Date(now.getTime() - DRAFT_TTL_MS)}`;
  return r ? toDraft(r) : null;
}

export async function saveDraft(sql: Sql, id: string, d: GuidedDraft & { weaponClass: string | null }): Promise<void> {
  await sql`
    update slot_draft set count = ${d.count}, slots = ${sql.json(d.slots as never)}, step = ${d.step},
      role = ${d.role}, weapon = ${d.weapon}, duty = ${d.duty}, weapon_class = ${d.weaponClass}
    where id = ${id}`;
}

export async function deleteDraft(sql: Sql, id: string): Promise<void> {
  await sql`delete from slot_draft where id = ${id}`;
}

export async function purgeDrafts(sql: Sql, now: Date): Promise<number> {
  const rows = await sql`
    delete from slot_draft where created_at <= ${new Date(now.getTime() - DRAFT_TTL_MS)} returning id`;
  const retries = await sql`delete from form_retry where created_at <= ${new Date(now.getTime() - DRAFT_TTL_MS)} returning id`;
  return rows.length + retries.length;
}
