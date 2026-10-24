-- Owner decision 2026-10-24 (ADR 0030): positions are numbered by role, Tank, DTank, Healer, Support, DPS, then any
-- other role in its current order. New and edited content is sorted in code; this sorts the content that exists.
-- Seats, duties and weapons belong to the slot row, so they move with it. Two steps (negative, then positive) keep
-- the unique (content_id, position) pair valid on every row.
with ranked as (
  select id, row_number() over (
    partition by content_id
    order by case lower(trim(role)) when 'tank' then 0 when 'dtank' then 1 when 'healer' then 2
      when 'support' then 3 when 'dps' then 4 else 5 end, position
  ) as n
  from slot
)
update slot set position = -ranked.n from ranked where slot.id = ranked.id;

update slot set position = -position where position < 0;
