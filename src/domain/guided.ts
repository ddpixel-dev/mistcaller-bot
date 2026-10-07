import type { Result, SlotDef } from "./types.ts";
import { DUTIES } from "./duties.ts";

export const MAX_SLOTS = 20;

// Owner decision 2026-10-07: only four roles. Jobs such as Caller or Scout are duties, set per slot.
export const GUIDED_ROLES = ["Tank", "Healer", "Support", "DPS"] as const;
export const NO_DUTY = "none";

// One card per slot. `step` is the card being filled; role, weapon and duty are its unsaved choices.
export type GuidedDraft = {
  count: number | null;
  slots: SlotDef[];
  step: number;
  role: string | null;
  weapon: string | null;
  duty: string | null;
};

export const emptyDraft = (): GuidedDraft => ({ count: null, slots: [], step: 0, role: null, weapon: null, duty: null });

export const isComplete = (d: GuidedDraft): boolean => d.count !== null && d.step >= d.count;
export const canSave = (d: GuidedDraft): boolean => d.count !== null && d.step < d.count && !!d.role && !!d.weapon;

// "How many players needed?" typed as a number, 1 to 20.
export function parseCount(input: string): Result<number> {
  const text = input.trim();
  if (!/^\d{1,3}$/.test(text)) return { ok: false, error: "Type a whole number from 1 to 20, like 10." };
  const n = Number(text);
  if (n < 1) return { ok: false, error: "At least 1 player is needed." };
  if (n > MAX_SLOTS) return { ok: false, error: `The maximum is ${MAX_SLOTS} players.` };
  return { ok: true, value: n };
}

// Show the saved slot of the current card (when going back or forward), or an empty card.
function load(d: GuidedDraft): GuidedDraft {
  const s = d.slots[d.step];
  return { ...d, role: s?.role ?? null, weapon: s?.weapon ?? null, duty: s?.duty ?? null };
}

export function setCount(d: GuidedDraft, n: number): GuidedDraft {
  if (!Number.isInteger(n) || n < 1 || n > MAX_SLOTS) return d;
  const slots = d.slots.slice(0, n);
  return load({ ...d, count: n, slots, step: Math.min(d.step, n) });
}

const live = (d: GuidedDraft) => d.count !== null && d.step < d.count;

export const setRole = (d: GuidedDraft, role: string): GuidedDraft =>
  live(d) && (GUIDED_ROLES as readonly string[]).includes(role) ? { ...d, role } : d;

export function setWeapon(d: GuidedDraft, weapon: string): GuidedDraft {
  const w = weapon.trim();
  return live(d) && w.length >= 1 && w.length <= 40 ? { ...d, weapon: w } : d;
}

// "none" clears the duty.
export function setDuty(d: GuidedDraft, duty: string): GuidedDraft {
  if (!live(d)) return d;
  if (duty === NO_DUTY) return { ...d, duty: null };
  return DUTIES.some((x) => x.id === duty) ? { ...d, duty } : d;
}

// Next: save the card's slot and move on. The last card moves to the end (complete).
export function next(d: GuidedDraft): GuidedDraft {
  if (!canSave(d)) return d;
  const slot: SlotDef = d.duty ? { role: d.role!, weapon: d.weapon!, duty: d.duty } : { role: d.role!, weapon: d.weapon! };
  const slots = [...d.slots];
  slots[d.step] = slot;
  return load({ ...d, slots, step: d.step + 1 });
}

// Back: the previous card, showing its saved choices. Unsaved choices on this card are dropped.
export function back(d: GuidedDraft): GuidedDraft {
  return d.step > 0 ? load({ ...d, step: d.step - 1 }) : d;
}

// Same as previous: put the previous slot's choices on this card (not saved until Next).
export function sameAsPrevious(d: GuidedDraft): GuidedDraft {
  const prev = d.slots[d.step - 1];
  if (!live(d) || !prev) return d;
  return { ...d, role: prev.role, weapon: prev.weapon, duty: prev.duty ?? null };
}

// Fill the rest: this card's choices go to this slot and every one after it.
export function fillRest(d: GuidedDraft): GuidedDraft {
  if (!canSave(d)) return d;
  const slot: SlotDef = d.duty ? { role: d.role!, weapon: d.weapon!, duty: d.duty } : { role: d.role!, weapon: d.weapon! };
  const slots = [...d.slots.slice(0, d.step)];
  for (let i = d.step; i < d.count!; i++) slots.push({ ...slot });
  return { ...d, slots, step: d.count!, role: null, weapon: null, duty: null };
}
