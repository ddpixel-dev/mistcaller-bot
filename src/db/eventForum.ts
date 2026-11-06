import type { Sql } from "./client.ts";

// Event forums (FR-053, ADR 0037): the forum where the bot posts each content of one type. A forum may serve several types.
export type ForumType = "pvp" | "pve" | "pvx";
export type EventForum = { guildId: string; forumId: string; type: ForumType; launcherThreadId: string | null };

const toForum = (r: Record<string, any>): EventForum => ({
  guildId: r.guild_id, forumId: r.forum_id, type: r.type as ForumType, launcherThreadId: r.launcher_thread_id ?? null,
});

// One of the types this forum serves (the first, by type), or null when it is not an event forum.
export async function getEventForum(sql: Sql, guildId: string, forumId: string): Promise<EventForum | null> {
  const [r] = await sql`select * from event_forum where guild_id = ${guildId} and forum_id = ${forumId} order by type limit 1`;
  return r ? toForum(r) : null;
}

export async function forumsOf(sql: Sql, guildId: string, forumId: string): Promise<EventForum[]> {
  return (await sql`select * from event_forum where guild_id = ${guildId} and forum_id = ${forumId} order by type`).map(toForum);
}

// The forum whose launcher post this is, if any.
export async function forumOfLauncher(sql: Sql, guildId: string, threadId: string): Promise<EventForum | null> {
  const [r] = await sql`select * from event_forum where guild_id = ${guildId} and launcher_thread_id = ${threadId}`;
  return r ? toForum(r) : null;
}

// Sets the forum of one type; the type's earlier forum is replaced.
export async function saveEventForum(sql: Sql, f: EventForum): Promise<void> {
  await sql`
    insert into event_forum (guild_id, type, forum_id, launcher_thread_id)
    values (${f.guildId}, ${f.type}, ${f.forumId}, ${f.launcherThreadId})
    on conflict (guild_id, type) do update set forum_id = excluded.forum_id, launcher_thread_id = excluded.launcher_thread_id`;
}

// Removes the forum from one type, or from every type it serves when none is given.
export async function deleteEventForum(sql: Sql, guildId: string, forumId: string, type: ForumType | null = null): Promise<void> {
  await sql`delete from event_forum where guild_id = ${guildId} and forum_id = ${forumId} and (${type}::text is null or type = ${type})`;
}

export async function listEventForums(sql: Sql, guildId: string): Promise<EventForum[]> {
  return (await sql`select * from event_forum where guild_id = ${guildId} order by created_at, type`).map(toForum);
}
