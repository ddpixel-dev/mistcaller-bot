-- Duty (Caller, Scout, Rat): assigned to a held position by a manager after players have signed up.
-- Cleared when the holder leaves or moves. The list of duties lives in code.
alter table slot add column duty text;
