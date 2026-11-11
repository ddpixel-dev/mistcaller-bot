// Bombers: a CTA list with no positions (ADR 0047). Pure domain (NFR-007).
import type { Result } from "./types.ts";

export const MAX_BOMBERS = 20;

// Empty means no Bombers. Digits only, so "2.5" and "1e1" are errors.
export function parseBombersCap(text: string): Result<number | null> {
  const t = text.trim();
  if (t === "") return { ok: true, value: null };
  const n = /^\d{1,3}$/.test(t) ? Number(t) : NaN;
  if (n >= 1 && n <= MAX_BOMBERS) return { ok: true, value: n };
  return { ok: false, error: `Bombers must be a number from 1 to ${MAX_BOMBERS}, or empty for no Bombers.` };
}
