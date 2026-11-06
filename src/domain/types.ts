import type { FillPref } from "./fillmatch.ts";
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
  selection?: boolean; // the host picks the party: signing up is an application (FR-058)
  applicants?: { userId: string; wants: string; pref?: FillPref }[]; // oldest first; they hold no seat
  fills?: string[]; // members waiting as a fill (no matching position was open), oldest first
  fillPrefs?: Record<string, FillPref>; // the same choices, for matching them to open positions
  fillWants?: Record<string, string>; // what each waiting fill asked for: "Any", or "Healer, #7" (FR-057)
  buildRef?: string | null;
  pingLeft?: number; // signed-up players (not the owner) who were not pinged yet (FR-038)
  votes: { split: number; regear: number };
  voteClosed: boolean;
  voteResult: "split" | "regear" | "tie" | "none" | null;
};
