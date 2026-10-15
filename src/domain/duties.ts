// A duty is a job a manager gives a player in the party on top of the role (Albion: call, scout, rat, loot).
export type DutyDef = { id: string; label: string; icon: string };

export const DUTIES: DutyDef[] = [
  { id: "caller", label: "Caller", icon: "📯" },
  { id: "scout", label: "Scout", icon: "🏹" },
  { id: "rat", label: "Rat", icon: "🐀" },
  { id: "looter", label: "Looter", icon: "💰" },
];

export const DUTY_WORD = "Duty";
export const CLEAR_DUTY = "none";

export const dutyDef = (id: string | null | undefined): DutyDef | null => DUTIES.find((d) => d.id === id) ?? null;
