import type { Result, RosterSlot, SlotDef } from "./types.ts";
import { dutyDef } from "./duties.ts";

export type SlotPlan = {
  rename: { id: string; role: string; weapon: string; duty: string | null }[];
  add: SlotDef[];
  remove: string[];
};

export function formatSlotLines(slots: { role: string; weapon: string; duty?: string | null }[]): string {
  return slots.map((s) => `${s.role}${s.weapon ? ` - ${s.weapon}` : ""}${dutyDef(s.duty) ? ` (${dutyDef(s.duty)!.label})` : ""}`).join("\n");
}

// FR-020, FR-055: lines are matched to slots by content, not by line number, so adding or removing a line never changes
// the role or weapon of a position someone holds. In order: (1) a line equal to a slot's role, weapon and duty keeps that
// slot (a held slot first, so an empty twin is the one removed); (2) the lines and slots left over are paired by role,
// then in order, and the slot is renamed; (3) a line with no slot adds one; (4) a slot with no line is removed, which is
// refused while someone holds it.
const sameDuty = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null);
const sameRole = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function planSlotEdit(current: RosterSlot[], next: SlotDef[]): Result<SlotPlan> {
  const ordered = [...current].sort((a, b) => a.position - b.position);
  const plan: SlotPlan = { rename: [], add: [], remove: [] };
  const free = [...ordered]; // slots no line has claimed yet, in position order
  const claim = (slot: RosterSlot) => void free.splice(free.indexOf(slot), 1);

  const unmatched: SlotDef[] = [];
  for (const want of next) {
    const exact = (s: RosterSlot) => s.role === want.role && s.weapon === want.weapon && sameDuty(s.duty, want.duty);
    const hit = free.find((s) => exact(s) && s.userId !== null) ?? free.find(exact);
    if (hit) claim(hit);
    else unmatched.push(want);
  }

  const toAdd: SlotDef[] = [];
  const pair = (want: SlotDef, slot: RosterSlot) => {
    claim(slot);
    plan.rename.push({ id: slot.id, role: want.role, weapon: want.weapon, duty: want.duty ?? null });
  };
  const rest: SlotDef[] = [];
  for (const want of unmatched) {
    const slot = free.find((s) => sameRole(s.role, want.role));
    if (slot) pair(want, slot);
    else rest.push(want);
  }
  for (const want of rest) {
    const slot = free[0];
    if (slot) pair(want, slot);
    else toAdd.push(want);
  }
  plan.add = toAdd;
  plan.remove = free.map((s) => s.id);
  const held = ordered.filter((s) => plan.remove.includes(s.id) && s.userId !== null);
  if (held.length > 0) {
    const list = held.map((s) => `${s.position}. ${s.role}${s.weapon ? ` - ${s.weapon}` : ""}`).join(", ");
    return {
      ok: false,
      error: `Cannot remove ${list}: someone holds it. Ask them to leave first, or keep the line.`,
    };
  }
  return { ok: true, value: plan };
}
