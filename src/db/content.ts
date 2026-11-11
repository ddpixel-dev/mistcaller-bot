import { describeFill } from "../domain/fillmatch.ts";
import { pingTargets } from "./ping.ts";
import type { Sql } from "./client.ts";
import { isVoteOpen, needsReminder, tallyVotes, type VoteChoice } from "../domain/vote.ts";
import type { ContentStatus, ContentType, RosterView, SlotDef } from "../domain/types.ts";
import { sortByRole, roleRank } from "../domain/roles.ts";
import { MAX_PARTY_SLOTS, displayNumber } from "../domain/parties.ts";

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
  selection?: boolean; // the host picks the party (FR-058)
  cta?: boolean; // a call to arms, announced in the CTA channel, with a thread for its roster (FR-059)
  blank?: boolean; // no roster: title, time, tier and description only (FR-060)
  createdBy: string;
  slots: SlotDef[];
  slots2?: SlotDef[]; // party 2 of a CTA (FR-070)
  rosterChannelId?: string | null; // the channel of the CTA's one roster message (ADR 0047)
  bombers?: number | null; // the Bombers cap (ADR 0047)
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
  const slots2 = input.slots2 ?? [];
  if (input.slots.length > MAX_PARTY_SLOTS) throw new Error(`Party 1 has ${input.slots.length} slots; the limit is ${MAX_PARTY_SLOTS}.`);
  if (slots2.length > MAX_PARTY_SLOTS) throw new Error(`Party 2 has ${slots2.length} slots; the limit is ${MAX_PARTY_SLOTS}.`);
  return await sql.begin(async (tx) => {
    const now = input.now ?? new Date();
    const [row] = await tx`
      insert into content (guild_id, thread_id, type, kind, title, notes, starts_at,
        gear_tier, has_loot, created_by, reminder_sent_at, build_channel_id, own_post, selection, cta, blank, party_count, roster_channel_id, bombers)
      values (${input.guildId}, ${input.threadId}, ${input.type}, ${input.kind ?? "other"}, ${input.title}, ${input.notes},
        ${input.startsAt}, ${input.tier}, ${input.hasLoot}, ${input.createdBy},
        ${needsReminder(input.startsAt, now) ? null : now}, ${input.buildRef ?? null}, ${input.ownPost ?? false}, ${input.selection ?? false}, ${input.cta ?? false}, ${input.blank ?? false}, ${slots2.length > 0 ? 2 : 1}, ${input.rosterChannelId ?? null}, ${input.bombers ?? null})
      returning id`;
    const id: string = row!.id;
    // Positions are numbered by role (ADR 0030).
    // Party 1 first, then party 2, each sorted by role; positions continue across.
    const ordered = [
      ...sortByRole(input.slots).map((s) => ({ s, party: 1 })),
      ...sortByRole(slots2).map((s) => ({ s, party: 2 })),
    ];
    const rows = ordered.map(({ s, party }, i) => ({
      guild_id: input.guildId,
      content_id: id,
      position: i + 1,
      party,
      role: s.role,
      weapon: s.weapon || null,
      duty: s.duty ?? null,
    }));
    if (rows.length > 0) await tx`insert into slot ${tx(rows, "guild_id", "content_id", "position", "party", "role", "weapon", "duty")}`;
    return id;
  });
}

export async function setMessageId(sql: Sql, contentId: string, messageId: string): Promise<void> {
  await sql`update content set message_id = ${messageId} where id = ${contentId}`;
}

// Party 1 is content.message_id; the others are in content_message (FR-070). Content with no row there is party 1 only.
export async function getPartyMessages(sql: Sql, contentId: string): Promise<{ party: number; messageId: string }[]> {
  const [c] = await sql`select message_id from content where id = ${contentId}`;
  const rest = await sql`select party, message_id from content_message where content_id = ${contentId} order by party`;
  const out: { party: number; messageId: string }[] = [];
  if (c?.message_id) out.push({ party: 1, messageId: c.message_id as string });
  for (const r of rest) out.push({ party: r.party as number, messageId: r.message_id as string });
  return out;
}

// A 0.31.8 call to arms' party 2 message, once it is turned into the moved note (ADR 0047): it is never edited again.
export async function deleteContentMessage(sql: Sql, contentId: string, party: number): Promise<void> {
  await sql`delete from content_message where content_id = ${contentId} and party = ${party}`;
}

export async function setPartyMessageId(
  sql: Sql,
  a: { guildId: string; contentId: string; party: number; messageId: string },
): Promise<void> {
  if (a.party === 1) {
    await setMessageId(sql, a.contentId, a.messageId);
    return;
  }
  await sql`
    insert into content_message (guild_id, content_id, party, message_id)
    values (${a.guildId}, ${a.contentId}, ${a.party}, ${a.messageId})
    on conflict (content_id, party) do update set message_id = excluded.message_id`;
}

export async function deleteContent(sql: Sql, contentId: string): Promise<void> {
  await sql`delete from content where id = ${contentId}`;
}

export async function getRosterView(sql: Sql, contentId: string, now: Date): Promise<RosterView | null> {
  const rows = await sql`select * from content where id = ${contentId}`;
  const c = rows[0];
  if (!c) return null;
  const [slots, voteRows, waiting, fills, applied, tentative, bombers] = await Promise.all([
    sql`
      select s.id, s.position, s.party, s.role, s.weapon, s.duty, su.user_id, su.chosen_weapon
      from slot s
      left join signup su on su.slot_id = s.id and su.status = 'signed'
      where s.content_id = ${contentId}
      order by s.position`,
    sql`select choice from vote where content_id = ${contentId}`,
    sql`select user_id, wait_role, party from signup where content_id = ${contentId} and status = 'waitlist' order by joined_at, user_id`,
    sql`select user_id, fill_roles, fill_slots, party from signup where content_id = ${contentId} and status = 'fill' order by joined_at, user_id`,
    sql`select user_id, fill_roles, fill_slots, party from signup where content_id = ${contentId} and status = 'applied' order by joined_at, user_id`,
    sql`select user_id from signup where content_id = ${contentId} and tentative order by joined_at, user_id`,
    sql`select user_id from signup where content_id = ${contentId} and status = 'bomber' order by joined_at, user_id`,
  ]);
  const tally = tallyVotes(voteRows.map((v) => v.choice as VoteChoice));
  const voteClosed = !isVoteOpen(c.starts_at, now);
  // A fill's chosen positions are shown with the numbers the roster shows (they restart in party 2).
  const shownOf = (id: string): number | undefined => {
    const s = slots.find((x) => x.id === id);
    return s ? displayNumber(s as { party: number; position: number }, slots as unknown as { party: number; position: number }[]) : undefined;
  };
  return {
    id: c.id,
    guildId: c.guild_id,
    threadId: c.thread_id,
    messageId: c.message_id,
    rosterChannelId: c.roster_channel_id ?? null,
    bombers: c.bombers ?? null,
    bomberIds: bombers.map((b) => b.user_id as string),
    type: c.type as ContentType,
    kind: c.kind,
    title: c.title,
    notes: c.notes,
    startsAt: c.starts_at,
    tier: c.gear_tier ?? "",
    hasLoot: c.has_loot,
    status: c.status as ContentStatus,
    partyCount: c.party_count ?? 1,
    slots: slots.map((s) => ({
      id: s.id,
      position: s.position,
      party: s.party,
      role: s.role,
      weapon: s.weapon ?? "",
      duty: s.duty ?? null,
      userId: s.user_id ?? null,
      chosenWeapon: s.chosen_weapon ?? null,
    })),
    selection: c.selection === true,
    cta: c.cta === true,
    blank: c.blank === true,
    applicants: applied.map((f) => {
      const roles = (f.fill_roles as string[] | null) ?? [], slotIds = (f.fill_slots as string[] | null) ?? [];
      const pref = { any: roles.length === 0 && slotIds.length === 0, roles, slotIds };
      return { userId: f.user_id as string, wants: describeFill(pref, shownOf), pref };
    }),
    fills: fills.map((f) => f.user_id as string),
    fillPrefs: Object.fromEntries(fills.map((f) => {
      const roles = (f.fill_roles as string[] | null) ?? [], slotIds = (f.fill_slots as string[] | null) ?? [];
      return [f.user_id as string, { any: roles.length === 0 && slotIds.length === 0, roles, slotIds }];
    })),
    fillWants: Object.fromEntries(fills.map((f) => {
      const roles = (f.fill_roles as string[] | null) ?? [], slotIds = (f.fill_slots as string[] | null) ?? [];
      const any = roles.length === 0 && slotIds.length === 0;
      return [f.user_id as string, describeFill({ any, roles, slotIds }, shownOf)];
    })),
    buildRef: c.build_channel_id ?? null,
    ownerId: c.created_by ?? null,
    tentative: tentative.map((t) => t.user_id as string),
    pingLeft: (await pingTargets(sql, contentId, c.created_by ?? null)).length,
    waitlist: waiting.map((w) => ({ userId: w.user_id as string, role: (w.wait_role as string | null) ?? "", party: w.party as number })),
    partyOf: Object.fromEntries([...waiting, ...fills, ...applied].map((r) => [r.user_id as string, r.party as number])),
    votes: { split: tally.split, regear: tally.regear },
    voteClosed,
    voteResult: voteClosed && c.has_loot ? tally.result : null,
  };
}

type Tx = Parameters<Parameters<Sql["begin"]>[1]>[0];

// Number the positions 1..n by role (ADR 0030) after an edit. Seats, duties and weapons belong to the slot, so they
// move with it. Two steps (negative, then positive) keep the unique (content, position) pair valid on every row.
export async function sortPositions(tx: Tx, contentId: string): Promise<void> {
  const rows = await tx`select id, position, party, role from slot where content_id = ${contentId} order by position`;
  const sorted = rows
    .map((r) => ({ id: r.id as string, position: r.position as number, party: r.party as number, role: (r.role ?? "") as string }))
    .sort((a, b) => a.party - b.party || roleRank(a.role) - roleRank(b.role) || a.position - b.position);
  if (sorted.every((r, i) => r.position === i + 1)) return;
  for (const [i, r] of sorted.entries()) await tx`update slot set position = ${-(i + 1)} where id = ${r.id}`;
  await tx`update slot set position = -position where content_id = ${contentId} and position < 0`;
}
