-- FR-019: a forum post holds at most one content that is not cancelled.
-- Older duplicates (from POC testing) are cancelled, never deleted: keep the newest per post.
update content c
set status = 'cancelled'
where c.status <> 'cancelled'
  and exists (
    select 1 from content n
    where n.guild_id = c.guild_id and n.thread_id = c.thread_id and n.status <> 'cancelled'
      and (n.created_at, n.id) > (c.created_at, c.id)
  );

create unique index content_one_active_per_post
  on content (guild_id, thread_id)
  where status <> 'cancelled';
