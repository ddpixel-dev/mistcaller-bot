// Parties of a call to arms (FR-070). Pure domain: no Discord or database imports (NFR-007).
// slot.position stays unique per content (party 1 first, then party 2); the number shown restarts at 1 in each party.
import { parseSlots } from "./parse.ts";
import { ROLE_ORDER } from "./roles.ts";
import type { Result, SlotDef } from "./types.ts";

export const MAX_PARTY_SLOTS = 20;
export const CTA_ROLES = ["Tank", "DTank", "Healer", "Support", "DPS"] as const;

// The single hook a later ZvZ feature changes.
export function maxPartiesFor(_kind: string, isCta: boolean): 1 | 2 {
  return isCta ? 2 : 1;
}

// `existing` are the party's current slots: a line equal to one of them (role, weapon, duty) is kept as it is, so a CTA
// created before the role list was fixed can still be edited. New or changed lines must use a supported role.
export function parseCtaSlots(input: string, party: number, parties: number, existing: { role: string; weapon?: string | null; duty?: string | null }[] = []): Result<SlotDef[]> {
  const parsed = parseSlots(input);
  if (!parsed.ok) return parsed;
  // parseSlots drops blank lines and keeps the order, so the nth slot is the nth non-blank line.
  const lineNumbers = input.split(/\r?\n/).map((l, i) => ({ text: l.trim(), n: i + 1 })).filter((l) => l.text !== "").map((l) => l.n);
  for (let i = 0; i < parsed.value.length; i++) {
    const slot = parsed.value[i]!;
    const role = slot.role;
    const unchanged = existing.some((e) => e.role === slot.role && (e.weapon ?? "") === (slot.weapon ?? "") && (e.duty ?? null) === (slot.duty ?? null));
    if (!unchanged && !(ROLE_ORDER as readonly string[]).includes(role.trim().toLowerCase())) {
      const where = parties > 1 ? `Party ${party}, line ${lineNumbers[i]}` : `Line ${lineNumbers[i]}`;
      return { ok: false, error: `${where}: "${role}" is not a supported role. Use Tank, DTank, Healer, Support or DPS.` };
    }
  }
  return parsed;
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
