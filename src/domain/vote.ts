export const VOTE_CUTOFF_MS = 300000;
// FR-011: players are reminded about 30 minutes before the start.
export const REMINDER_LEAD_MS = 30 * 60 * 1000;

// Nothing to remind when the start is already inside the lead time.
export const needsReminder = (startsAt: Date, now: Date): boolean => startsAt.getTime() - now.getTime() > REMINDER_LEAD_MS;

export type VoteChoice = "split" | "regear";

export function isVoteOpen(startsAt: Date, now: Date): boolean {
  return now.getTime() < startsAt.getTime() - VOTE_CUTOFF_MS;
}

export function tallyVotes(choices: VoteChoice[]): {
  split: number;
  regear: number;
  result: "split" | "regear" | "tie" | "none";
} {
  let split = 0;
  let regear = 0;
  for (const c of choices) {
    if (c === "split") split++;
    else regear++;
  }
  const result = split + regear === 0 ? "none" : split === regear ? "tie" : split > regear ? "split" : "regear";
  return { split, regear, result };
}
