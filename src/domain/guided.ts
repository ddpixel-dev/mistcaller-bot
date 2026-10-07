import type { SlotDef } from "./types.ts";

export const MAX_SLOTS = 20;

// The roles offered in the guided steps. A custom role is still possible by editing the final form.
export const GUIDED_ROLES = [
  "Tank", "Off-Tank", "Healer", "Support", "DPS", "Ranged DPS", "Scout", "Caller", "Mage", "Assassin",
] as const;

export type GuidedDraft = {
  count: number | null;
  slots: SlotDef[];
  role: string | null;
  weapon: string | null;
};

export const emptyDraft = (): GuidedDraft => ({ count: null, slots: [], role: null, weapon: null });

export const isComplete = (d: GuidedDraft): boolean => d.count !== null && d.slots.length >= d.count;

// A role and a weapon together make one slot; it is added as soon as both are chosen.
function commit(d: GuidedDraft): GuidedDraft {
  if (d.role && d.weapon && d.count !== null && d.slots.length < d.count) {
    return { ...d, slots: [...d.slots, { role: d.role, weapon: d.weapon }], role: null, weapon: null };
  }
  return d;
}

export function setCount(d: GuidedDraft, n: number): GuidedDraft {
  if (!Number.isInteger(n) || n < 1 || n > MAX_SLOTS) return d;
  // A smaller count than the slots already chosen keeps only the first n.
  return { ...d, count: n, slots: d.slots.slice(0, n), role: null, weapon: null };
}

export const setRole = (d: GuidedDraft, role: string): GuidedDraft =>
  (GUIDED_ROLES as readonly string[]).includes(role) && !isComplete(d) && d.count !== null ? commit({ ...d, role }) : d;

export const setWeapon = (d: GuidedDraft, weapon: string): GuidedDraft => {
  const w = weapon.trim();
  return w.length >= 1 && w.length <= 40 && !isComplete(d) && d.count !== null ? commit({ ...d, weapon: w }) : d;
};

export function sameAsPrevious(d: GuidedDraft): GuidedDraft {
  const last = d.slots[d.slots.length - 1];
  if (!last || isComplete(d)) return d;
  return { ...d, slots: [...d.slots, { ...last }], role: null, weapon: null };
}

export function fillRest(d: GuidedDraft): GuidedDraft {
  const last = d.slots[d.slots.length - 1];
  if (!last || d.count === null || isComplete(d)) return d;
  const rest = Array.from({ length: d.count - d.slots.length }, () => ({ ...last }));
  return { ...d, slots: [...d.slots, ...rest], role: null, weapon: null };
}

// Back clears a half-chosen slot first, then removes the last finished one.
export function back(d: GuidedDraft): GuidedDraft {
  if (d.role || d.weapon) return { ...d, role: null, weapon: null };
  return { ...d, slots: d.slots.slice(0, -1) };
}
