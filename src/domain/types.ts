export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export type Tier = { tier: number; enchant: number };
export type TierRange = { min: Tier; max: Tier | null };
export type SlotDef = { role: string; weapon: string };
