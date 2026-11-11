// Massing at: where the party gathers, typed by the host (FR-074). Pure domain (NFR-007).
import type { Result } from "./types.ts";

export const MAX_MASSING = 100;

// Empty means none. Control characters become spaces; a channel mention such as <#123> is kept as typed.
export function parseMassing(text: string): Result<string | null> {
  const t = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (t === "") return { ok: true, value: null };
  if (Array.from(t).length > MAX_MASSING) return { ok: false, error: `Massing at can be at most ${MAX_MASSING} characters.` };
  return { ok: true, value: t };
}
