import type { Result, SlotDef } from "./types.ts";

export const MAX_SLOTS = 20;

// Owner decision 2026-10-07: only four roles. Jobs such as Caller or Scout are duties, assigned later.
export const GUIDED_ROLES = ["Tank", "Healer", "Support", "DPS"] as const;

export type GuidedDraft = {
  counts: number[] | null; // one number per role, in the order of GUIDED_ROLES
  slots: SlotDef[];
};

export const emptyDraft = (): GuidedDraft => ({ counts: null, slots: [] });

export const total = (d: GuidedDraft): number => (d.counts ? d.counts.reduce((a, b) => a + b, 0) : 0);
export const isComplete = (d: GuidedDraft): boolean => d.counts !== null && d.slots.length >= total(d);

// The role of the next slot follows the typed numbers: all Tanks first, then Healers, Support, DPS.
export function roleAt(d: GuidedDraft, index: number): string | null {
  if (!d.counts) return null;
  let left = index;
  for (let r = 0; r < GUIDED_ROLES.length; r++) {
    if (left < d.counts[r]!) return GUIDED_ROLES[r]!;
    left -= d.counts[r]!;
  }
  return null;
}

export const nextRole = (d: GuidedDraft): string | null => roleAt(d, d.slots.length);

// Typed text from the form, one value per role. Empty means 0.
export function parseCounts(inputs: string[]): Result<number[]> {
  const counts: number[] = [];
  for (let r = 0; r < GUIDED_ROLES.length; r++) {
    const text = (inputs[r] ?? "").trim();
    if (text === "") {
      counts.push(0);
      continue;
    }
    if (!/^\d{1,2}$/.test(text)) return { ok: false, error: `${GUIDED_ROLES[r]} must be a whole number, like 2.` };
    counts.push(Number(text));
  }
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum < 1) return { ok: false, error: "Type at least one member in total." };
  if (sum > MAX_SLOTS) return { ok: false, error: `That is ${sum} members. The maximum is ${MAX_SLOTS}.` };
  return { ok: true, value: counts };
}

// New numbers start the slots over, because the roles of the finished slots may no longer fit.
export function setCounts(d: GuidedDraft, counts: number[]): GuidedDraft {
  const same = d.counts && d.counts.every((n, i) => n === counts[i]);
  return same ? d : { counts, slots: [] };
}

export function setWeapon(d: GuidedDraft, weapon: string): GuidedDraft {
  const w = weapon.trim();
  const role = nextRole(d);
  if (!role || w.length < 1 || w.length > 40) return d;
  return { ...d, slots: [...d.slots, { role, weapon: w }] };
}

export function sameAsPrevious(d: GuidedDraft): GuidedDraft {
  const last = d.slots[d.slots.length - 1];
  return last ? setWeapon(d, last.weapon) : d;
}

export function fillRest(d: GuidedDraft): GuidedDraft {
  const last = d.slots[d.slots.length - 1];
  if (!last || isComplete(d)) return d;
  let next = d;
  while (!isComplete(next)) next = setWeapon(next, last.weapon);
  return next;
}

export const back = (d: GuidedDraft): GuidedDraft => ({ ...d, slots: d.slots.slice(0, -1) });
