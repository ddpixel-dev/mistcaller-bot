import type { Interaction } from "../discord/types.ts";
import { BOMBERS_GROUP, displayNumber, withParty } from "../domain/parties.ts";
import type { RosterView } from "../domain/types.ts";

// Remove player and Attendance (FR-071) also offer Bombers, as group 3, when the content has Bombers.
type Groups = { partyCount: number; bombers?: number | null };
const hasBombers = (view: Groups, opts: { bombers?: boolean }) => opts.bombers === true && view.bombers !== null && view.bombers !== undefined;

// The groups a host panel can be about: the parties, then Bombers when offered.
export function groupsOf(view: Groups, opts: { bombers?: boolean } = {}): number[] {
  return [...Array.from({ length: view.partyCount }, (_, k) => k + 1), ...(hasBombers(view, opts) ? [BOMBERS_GROUP] : [])];
}
export const groupName = (group: number): string => (group === BOMBERS_GROUP ? "Bombers" : `Party ${group}`);

// FR-070: a host panel on a two-party CTA first asks which party it is about. The buttons carry
// `<prefix>:<content>`, `<prefix>:<content>@2` and, with `bombers` (FR-071), **💣 Bombers** as `@3`. With a single
// group it returns null and the panel opens directly.
export function partyChoice(customIdPrefix: string, contentId: string, view: Groups, opts: { bombers?: boolean } = {}): unknown | null {
  const groups = groupsOf(view, opts);
  if (groups.length < 2) return null;
  return {
    type: 1,
    components: groups.map((n) => ({
      type: 2, style: 2, label: groupName(n), ...(n === BOMBERS_GROUP ? { emoji: { name: "💣" } } : {}),
      custom_id: withParty(`${customIdPrefix}:${contentId}`, n),
    })),
  };
}

// The party a component belongs to (the dispatcher strips the "@2" suffix into i.party), or null when the content
// has no such party, which the handler answers as "This control is not valid". Group 3 is valid only with `bombers`
// on content that has Bombers.
export function partyOfClick(i: Interaction, view: Groups, opts: { bombers?: boolean } = {}): number | null {
  const party = i.party ?? 1;
  return groupsOf(view, opts).includes(party) ? party : null;
}

export const slotsOfParty = (view: RosterView, party: number) => view.slots.filter((s) => s.party === party);
export const userInParty = (view: RosterView, userId: string, party: number) => (view.partyOf?.[userId] ?? 1) === party;
// The number the roster shows for a position (it restarts at 1 in party 2).
export const shownNumberOfSlot = (view: RosterView, slotId: string): number | undefined => {
  const s = view.slots.find((x) => x.id === slotId);
  return s ? displayNumber(s, view.slots) : undefined;
};
export const shownNumber = (view: RosterView, position: number): number => {
  const s = view.slots.find((x) => x.position === position);
  return s ? displayNumber(s, view.slots) : position;
};
