import type { Result, RosterSlot, SlotDef } from "./types.ts";
import { dutyDef } from "./duties.ts";

export type SlotPlan = {
  rename: { id: string; role: string; weapon: string; duty: string | null }[];
  add: SlotDef[];
  remove: string[];
};

export function formatSlotLines(slots: { role: string; weapon: string; duty?: string | null }[]): string {
  return slots.map((s) => `${s.role} - ${s.weapon}${dutyDef(s.duty) ? ` (${dutyDef(s.duty)!.label})` : ""}`).join("\n");
}

// FR-020: lines map to positions. A changed line renames that slot, extra lines add slots, and
// dropping trailing lines removes slots only when nobody holds them.
export function planSlotEdit(current: RosterSlot[], next: SlotDef[]): Result<SlotPlan> {
  const ordered = [...current].sort((a, b) => a.position - b.position);
  const plan: SlotPlan = { rename: [], add: [], remove: [] };
  ordered.forEach((slot, i) => {
    const want = next[i];
    if (!want) {
      plan.remove.push(slot.id);
    } else if (want.role !== slot.role || want.weapon !== slot.weapon || (want.duty ?? null) !== (slot.duty ?? null)) {
      plan.rename.push({ id: slot.id, role: want.role, weapon: want.weapon, duty: want.duty ?? null });
    }
  });
  plan.add = next.slice(ordered.length);
  const held = ordered.filter((s) => plan.remove.includes(s.id) && s.userId !== null);
  if (held.length > 0) {
    const list = held.map((s) => `${s.position}. ${s.role} - ${s.weapon}`).join(", ");
    return {
      ok: false,
      error: `Cannot remove ${list}: someone holds it. Ask them to leave first, or keep the line.`,
    };
  }
  return { ok: true, value: plan };
}
