-- FR-011: a player reminder is sent once, about 30 minutes before the start. Null means not sent yet.
-- A content created inside the 30 minutes, or edited to start inside them, is marked as sent: nothing to remind.
alter table content add column reminder_sent_at timestamptz;
