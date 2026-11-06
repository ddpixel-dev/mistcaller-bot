import { roleRank } from "./roles.ts";

// FR-057: what a fill is willing to play. Any position, chosen roles, chosen positions (slot ids, so adding a position
// never changes what was asked for), or a mix of roles and positions.
export type FillPref = { any: boolean; roles: string[]; slotIds: string[] };
export type OpenSlot = { id: string; position: number; role: string };

export const ANY_FILL: FillPref = { any: true, roles: [], slotIds: [] };
export const MAX_FILL_VALUES = 25; // a Discord menu holds 25 options

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const isHealer = (role: string) => same(role, "healer");

export function fillMatches(pref: FillPref, slot: OpenSlot): boolean {
  return pref.any || pref.roles.some((r) => same(r, slot.role)) || pref.slotIds.includes(slot.id);
}

// The open position a fill takes: healers first (owner request 2026-11-06), then, for Any, by role order (Tank, DTank,
// Support, DPS), then the lowest position.
export function pickFillSlot<T extends OpenSlot>(pref: FillPref, open: readonly T[]): T | null {
  const key = (s: T) => [isHealer(s.role) ? 0 : 1, pref.any ? roleRank(s.role) : 0, s.position] as const;
  const matches = open.filter((s) => fillMatches(pref, s)).sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  });
  return matches[0] ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The values of the fill menu: "any", "r:<role>", "s:<slot id>". Anything else is refused (a client can send any value).
export function parseFillValues(values: unknown): FillPref | null {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_FILL_VALUES) return null;
  const roles: string[] = [];
  const slotIds: string[] = [];
  for (const v of values) {
    if (typeof v !== "string") return null;
    if (v === "any") return ANY_FILL;
    if (v.startsWith("r:")) {
      const role = v.slice(2);
      if (role.length === 0 || role.length > 100) return null;
      if (!roles.some((r) => same(r, role))) roles.push(role);
    } else if (v.startsWith("s:")) {
      const id = v.slice(2);
      if (!UUID.test(id)) return null;
      if (!slotIds.includes(id)) slotIds.push(id);
    } else return null;
  }
  return { any: false, roles, slotIds };
}

// For the roster and the announcement: "Any", or "Healer, Tank, #3, #7" (roles, then position numbers).
export function describeFill(pref: FillPref, positionOf: (slotId: string) => number | undefined): string {
  if (pref.any) return "Any";
  const numbers = pref.slotIds.map(positionOf).filter((n): n is number => n !== undefined).sort((a, b) => a - b);
  const parts = [...pref.roles, ...numbers.map((n) => `#${n}`)];
  return parts.length ? parts.join(", ") : "Any";
}
