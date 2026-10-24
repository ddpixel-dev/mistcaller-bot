import type { Sql } from "./client.ts";

// Event forums (FR-053, ADR 0032): forums whose posts the bot creates from a pinned launcher post.
export type EventForum = { guildId: string; forumId: string; type: "pvp" | "pve" | null; launcherThreadId: string | null };

const toForum = (r: Record<string, any>): EventForum => ({
  guildId: r.guild_id, forumId: r.forum_id, type: r.type === "pvp" || r.type === "pve" ? r.type : null, launcherThreadId: r.launcher_thread_id ?? null,
});

export async function getEventForum(sql: Sql, guildId: string, forumId: string): Promise<EventForum | null> {
  const [r] = await sql`select * from event_forum where guild_id = ${guildId} and forum_id = ${forumId}`;
  return r ? toForum(r) : null;
}

// The forum whose launcher post this is, if any.
export async function forumOfLauncher(sql: Sql, guildId: string, threadId: string): Promise<EventForum | null> {
  const [r] = await sql`select * from event_forum where guild_id = ${guildId} and launcher_thread_id = ${threadId}`;
  return r ? toForum(r) : null;
}

export async function saveEventForum(sql: Sql, f: EventForum): Promise<void> {
  await sql`
    insert into event_forum (guild_id, forum_id, type, launcher_thread_id)
    values (${f.guildId}, ${f.forumId}, ${f.type}, ${f.launcherThreadId})
    on conflict (guild_id, forum_id) do update set type = excluded.type, launcher_thread_id = excluded.launcher_thread_id`;
}

export async function deleteEventForum(sql: Sql, guildId: string, forumId: string): Promise<void> {
  await sql`delete from event_forum where guild_id = ${guildId} and forum_id = ${forumId}`;
}

export async function listEventForums(sql: Sql, guildId: string): Promise<EventForum[]> {
  return (await sql`select * from event_forum where guild_id = ${guildId} order by created_at`).map(toForum);
}
