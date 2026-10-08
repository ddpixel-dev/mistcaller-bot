-- Gear tier is free text (owner decision 2026-10-08), for example "Weapon T7.1 - Gear T4.3". Existing contents keep
-- what they showed: the old tier or range is copied as text. The old numeric columns stay, unused.
alter table content add column gear_tier text;

update content set gear_tier = case
  when min_tier is null then null
  when max_tier is null then 'T' || min_tier || '.' || min_enchant
  else 'T' || min_tier || '.' || min_enchant || '–T' || max_tier || '.' || max_enchant
end;
