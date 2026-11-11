import type { Interaction } from "../discord/types.ts";
import { displayNumber, withParty } from "../domain/parties.ts";
import type { RosterView } from "../domain/types.ts";

// FR-070: a host panel on a two-party CTA first asks which party it is about. The two buttons carry
// `<prefix>:<content>` and `<prefix>:<content>@2`; one party returns null and the panel opens directly.
export function partyChoice(customIdPrefix: string, contentId: string, view: RosterView): unknown | null {
  if (view.partyCount < 2) return null;
  return {
    type: 1,
    components: [1, 2].map((n) => ({ type: 2, style: 2, label: `Party ${n}`, custom_id: withParty(`${customIdPrefix}:${contentId}`, n) })),
  };
}

// The party a component belongs to (the dispatcher strips the "@2" suffix into i.party), or null when it is
// greater than the parties of this content, which the handler answers as "This control is not valid".
export function partyOfClick(i: Interaction, view: RosterView): number | null {
  const party = i.party ?? 1;
  return party >= 1 && party <= view.partyCount ? party : null;
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
