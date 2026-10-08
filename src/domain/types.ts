export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
// An empty weapon means the slot is a role alone: the player brings the weapon (FR-030).
export type SlotDef = { role: string; weapon: string; duty?: string | null };
export type ContentType = "pvp" | "pve" | "pvx";
export type ContentStatus = "open" | "locked" | "cancelled" | "done";
export type RosterSlot = {
  id: string;
  position: number;
  role: string;
  weapon: string;
  userId: string | null;
  duty?: string | null;
  chosenWeapon?: string | null; // the holder's own weapon, for a slot without one
};
export type RosterView = {
  id: string;
  guildId: string;
  threadId: string;
  messageId: string | null;
  type: ContentType;
  kind: string;
  title: string;
  notes: string | null;
  startsAt: Date;
  tier: string; // free text, shown as typed
  hasLoot: boolean;
  status: ContentStatus;
  slots: RosterSlot[];
  waitlist?: { userId: string; role: string }[];
  fills?: string[]; // members signed up as Fill (any position), oldest first
  buildChannelId?: string | null;
  pinged?: boolean;
  votes: { split: number; regear: number };
  voteClosed: boolean;
  started: boolean;
  voteResult: "split" | "regear" | "tie" | "none" | null;
};
