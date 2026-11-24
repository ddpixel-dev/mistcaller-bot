// Parties of a call to arms (FR-070). Pure domain: no Discord or database imports (NFR-007).
// slot.position stays unique per content (party 1 first, then party 2); the number shown restarts at 1 in each party.
import { parseSlots } from "./parse.ts";
import type { Result, SlotDef, SlotMode } from "./types.ts";

export const MAX_PARTY_SLOTS = 20;
export const CTA_ROLES = ["Tank", "DTank", "Healer", "Support", "DPS"] as const;

// Every content may have two parties (FR-081, owner request 2026-11-25); the host chooses on the card.
export function maxPartiesFor(_kind: string, _isCta: boolean): 1 | 2 {
  return 2;
}

// One party's lines (FR-070), checked like every content's (FR-077) and read in the content's mode (FR-076). `existing` are
// the party's current slots: a line equal to one of them is kept unchecked, so an older roster can still be edited.
// With two parties the error names the party.
export function parseCtaSlots(input: string, party: number, parties: number, existing: { role: string; weapon?: string | null; duty?: string | null }[] = [], mode: SlotMode = "role"): Result<SlotDef[]> {
  const parsed = parseSlots(input, mode, existing);
  if (parsed.ok || parties <= 1) return parsed;
  return { ok: false, error: parsed.error.replace(/^Line /, `Party ${party}, line `) };
}

// The group number of Bombers in a host panel's party choice (FR-071): Remove player and Attendance only.
export const BOMBERS_GROUP = 3;

// Party 1 keeps the plain custom id; party 2 ends in "@2"; Bombers (in Remove player and Attendance) end in "@3".
export function splitParty(customId: string): { id: string; party: number } | null {
  const at = customId.lastIndexOf("@");
  if (at === -1) return { id: customId, party: 1 };
  const suffix = customId.slice(at + 1);
  if (suffix !== "1" && suffix !== "2" && suffix !== "3") return null;
  return { id: customId.slice(0, at), party: Number(suffix) };
}

export function withParty(customId: string, party: number): string {
  return party === 1 ? customId : `${customId}@${party}`;
}

// Two-party content names the party in front of a shown position ("Party 2 · 1. Tank"); one party adds nothing.
export const partyLead = (partyCount: number, party: number): string => (partyCount > 1 ? `Party ${party} · ` : "");
// "position 3" for one party, "Party 2, position 1" for two.
export const positionText = (partyCount: number, party: number, shown: number): string =>
  partyCount > 1 ? `Party ${party}, position ${shown}` : `position ${shown}`;

export function displayNumber(slot: { party: number; position: number }, all: { party: number; position: number }[]): number {
  return slot.position - all.filter((s) => s.party < slot.party).length;
}

// The CTA party picker text (ADR 0047).
export const PARTIES_PLACEHOLDER = "How many parties?";
export const ONE_PARTY_LABEL = "One Party";
export const ONE_PARTY_EMOJI = "👤";
export const TWO_PARTIES_LABEL = "Two Parties";
export const TWO_PARTIES_EMOJI = "👥";
