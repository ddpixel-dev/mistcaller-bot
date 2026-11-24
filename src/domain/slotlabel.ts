// FR-076 (ADR 0049): one label per slot. A slot of a role-mode content has a role; a slot of a weapon-mode content has
// no role and a weapon. Whatever groups, matches or names slots (the waitlist, fills, menus, slot edits) uses this label,
// so both modes share the same code.
type Named = { role: string; weapon: string };

export const slotLabel = (s: Named): string => s.role || s.weapon;

// What menus and lists show for a slot, without its duty: "Tank - Mace", "Tank" (a role alone), or "Bow".
export const slotText = (s: Named & { duty?: string | null }): string => (s.role ? `${s.role}${s.weapon ? ` - ${s.weapon}` : ""}` : s.weapon);
