import { pingTargets } from "./ping.ts";
import type { Sql } from "./client.ts";
import { isVoteOpen, needsReminder, tallyVotes, type VoteChoice } from "../domain/vote.ts";
import type { ContentStatus, ContentType, RosterView, SlotDef } from "../domain/types.ts";
import { sortByRole } from "../domain/roles.ts";

export type NewContent = {
  guildId: string;
  threadId: string;
  type: ContentType;
  kind?: string;
  title: string;
  notes: string | null;
  startsAt: Date;
  tier: string;
  hasLoot: boolean;
  createdBy: string;
  slots: SlotDef[];
  buildRef?: string | null;
  ownPost?: boolean; // the bot created the post (ADR 0032): renamed when the title changes
  now?: Date;
};

export class PostTakenError extends Error {
  constructor() {
    super("post already has content");
    this.name = "PostTakenError";
  }
}

function isPostTaken(err: unknown): boolean {
  const e = err as { code?: string; constraint_name?: string } | null;
  return e?.code === "23505" && e.constraint_name === "content_one_active_per_post";
}

export async function createContent(sql: Sql, input: NewContent): Promise<string> {
  try {
    return await insertContent(sql, input);
  } catch (err) {
    if (isPostTaken(err)) throw new PostTakenError();
    throw err;
  }
}

export async function findContentInThread(
  sql: Sql,
  guildId: string,
  threadId: string,
): Promise<{ id: string; status: ContentStatus; messageId: string | null } | null> {
  const [row] = await sql`
    select id, status, message_id from content
    where guild_id = ${guildId} and thread_id = ${threadId} and status <> 'cancelled'`;
  return row ? { id: row.id, status: row.status as ContentStatus, messageId: row.message_id } : null;
}

async function insertContent(sql: Sql, input: NewContent): Promise<string> {
  return await sql.begin(async (tx) => {
    const now = input.now ?? new Date();
    const [row] = await tx`
      insert into content (guild_id, thread_id, type, kind, title, notes, starts_at,
        gear_tier, has_loot, created_by, reminder_sent_at, build_channel_id, own_post)
      values (${input.guildId}, ${input.threadId}, ${input.type}, ${input.kind ?? "other"}, ${input.title}, ${input.notes},
        ${input.startsAt}, ${input.tier}, ${input.hasLoot}, ${input.createdBy},
        ${needsReminder(input.startsAt, now) ? null : now}, ${input.buildRef ?? null}, ${input.ownPost ?? false})
      returning id`;
    const id: string = row!.id;
    // Positions are numbered by role (ADR 0030).
    const rows = sortByRole(input.slots).map((s, i) => ({
      guild_id: input.guildId,
      content_id: id,
      position: i + 1,
      role: s.role,
      weapon: s.weapon || null,
      duty: s.duty ?? null,
    }));
    await tx`insert into slot ${tx(rows, "guild_id", "content_id", "position", "role", "weapon", "duty")}`;
    return id;
  });
}

export async function setMessageId(sql: Sql, contentId: string, messageId: string): Promise<void> {
  await sql`update content set message_id = ${messageId} where id = ${contentId}`;
}

export async function deleteContent(sql: Sql, contentId: string): Promise<void> {
  await sql`delete from content where id = ${contentId}`;
}

export async function getRosterView(sql: Sql, contentId: string, now: Date): Promise<RosterView | null> {
  const rows = await sql`select * from content where id = ${contentId}`;
  const c = rows[0];
  if (!c) return null;
  const [slots, voteRows, waiting, fills] = await Promise.all([
    sql`
      select s.id, s.position, s.role, s.weapon, s.duty, su.user_id, su.chosen_weapon
      from slot s
      left join signup su on su.slot_id = s.id and su.status = 'signed'
      where s.content_id = ${contentId}
      order by s.position`,
    sql`select choice from vote where content_id = ${contentId}`,
    sql`select user_id, wait_role from signup where content_id = ${contentId} and status = 'waitlist' order by joined_at, user_id`,
    sql`select user_id from signup where content_id = ${contentId} and status = 'fill' order by joined_at, user_id`,
  ]);
  const tally = tallyVotes(voteRows.map((v) => v.choice as VoteChoice));
  const voteClosed = !isVoteOpen(c.starts_at, now);
  return {
    id: c.id,
    guildId: c.guild_id,
    threadId: c.thread_id,
    messageId: c.message_id,
    type: c.type as ContentType,
    kind: c.kind,
    title: c.title,
    notes: c.notes,
    startsAt: c.starts_at,
    tier: c.gear_tier ?? "",
    hasLoot: c.has_loot,
    status: c.status as ContentStatus,
    slots: slots.map((s) => ({
      id: s.id,
      position: s.position,
      role: s.role,
      weapon: s.weapon ?? "",
      duty: s.duty ?? null,
      userId: s.user_id ?? null,
      chosenWeapon: s.chosen_weapon ?? null,
    })),
    fills: fills.map((f) => f.user_id as string),
    buildRef: c.build_channel_id ?? null,
    pingLeft: (await pingTargets(sql, contentId, c.created_by ?? null)).length,
    waitlist: waiting.map((w) => ({ userId: w.user_id as string, role: (w.wait_role as string | null) ?? "" })),
    votes: { split: tally.split, regear: tally.regear },
    voteClosed,
    voteResult: voteClosed && c.has_loot ? tally.result : null,
  };
}

type Tx = Parameters<Parameters<Sql["begin"]>[1]>[0];

// Number the positions 1..n by role (ADR 0030) after an edit. Seats, duties and weapons belong to the slot, so they
// move with it. Two steps (negative, then positive) keep the unique (content, position) pair valid on every row.
export async function sortPositions(tx: Tx, contentId: string): Promise<void> {
  const rows = await tx`select id, position, role from slot where content_id = ${contentId} order by position`;
  const sorted = sortByRole(rows.map((r) => ({ id: r.id as string, position: r.position as number, role: (r.role ?? "") as string })));
  if (sorted.every((r, i) => r.position === i + 1)) return;
  for (const [i, r] of sorted.entries()) await tx`update slot set position = ${-(i + 1)} where id = ${r.id}`;
  await tx`update slot set position = -position where content_id = ${contentId} and position < 0`;
}
