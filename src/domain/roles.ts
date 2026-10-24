// The roster is ordered by role (owner request 2026-10-24, ADR 0030): Tank, DTank, Healer, Support, DPS, then any other
// role in the order it was written. Roles are matched by name, ignoring case and surrounding spaces.
export const ROLE_ORDER = ["tank", "dtank", "healer", "support", "dps"] as const;

export function roleRank(role: string): number {
  const i = (ROLE_ORDER as readonly string[]).indexOf(role.trim().toLowerCase());
  return i === -1 ? ROLE_ORDER.length : i;
}

// A stable sort: positions of the same rank keep their order.
export function sortByRole<T extends { role: string }>(slots: readonly T[]): T[] {
  return slots.map((s, i) => ({ s, i })).sort((a, b) => roleRank(a.s.role) - roleRank(b.s.role) || a.i - b.i).map((x) => x.s);
}
