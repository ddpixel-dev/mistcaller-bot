import type { Result, SlotDef } from "./types.ts";
import { DUTIES } from "./duties.ts";

const START_HELP = "Use the format YYYY-MM-DD HH:MM in UTC, in the future, for example 2026-10-07 18:00.";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const GEAR_TIER_LIMIT = 80;

// Gear tier is free text (owner decision 2026-10-08), for example "Weapon T7.1 - Gear T4.3". It is shown as typed.
export function parseGearTier(input: string): Result<string> {
  const text = input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (text === "") return fail("Add the gear tier as free text, for example Weapon T7.1 - Gear T4.3.");
  if (Array.from(text).length > GEAR_TIER_LIMIT) return fail(`The gear tier is too long (${GEAR_TIER_LIMIT} characters at most).`);
  return { ok: true, value: text };
}

export function parseSlots(input: string): Result<SlotDef[]> {
  const lines = input.split(/\r?\n/).map((l, i) => ({ text: l.trim(), n: i + 1 })).filter((l) => l.text !== "");
  if (lines.length === 0) return fail("Add at least one slot, one per line, like: Tank - Great Axe");
  if (lines.length > 20) return fail(`Too many slots (${lines.length}). The maximum is 20.`);
  const slots: SlotDef[] = [];
  for (const { text, n } of lines) {
    // Prefer the first spaced separator so roles like "Off-Tank" survive; else the first bare dash.
    const spaced = /\s[-–]\s/.exec(text);
    const idx = spaced ? spaced.index + 1 : text.search(/[-–]/);
    if (idx < 0) return fail(`Slot on line ${n} needs a role and a weapon separated by a dash, like: Tank - Great Axe`);
    const role = text.slice(0, idx).trim();
    let weapon = text.slice(idx + 1).trim();
    // An optional duty in brackets at the end: "Tank - Great Axe (Caller)".
    let duty: string | null = null;
    const bracket = /\s*\(([^()]*)\)\s*$/.exec(weapon);
    if (bracket) {
      const found = DUTIES.find((d) => d.label.toLowerCase() === bracket[1]!.trim().toLowerCase());
      if (!found) return fail(`Unknown duty "${bracket[1]!.trim()}" on line ${n}. Use ${DUTIES.map((d) => d.label).join(", ")}.`);
      duty = found.id;
      weapon = weapon.slice(0, bracket.index).trim();
    }
    if (!role || !weapon) return fail(`Slot on line ${n} needs both a role and a weapon, like: Tank - Great Axe`);
    if (role.length > 30) return fail(`Role on line ${n} is too long (max 30 characters).`);
    if (weapon.length > 40) return fail(`Weapon on line ${n} is too long (max 40 characters).`);
    slots.push(duty ? { role, weapon, duty } : { role, weapon });
  }
  return { ok: true, value: slots };
}

export function parseUtcStart(input: string, now: Date): Result<Date> {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?: UTC)?$/.exec(input.trim());
  if (!m) return fail(`Invalid start time "${input}". ${START_HELP}`);
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number) as [number, number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (
    date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d ||
    date.getUTCHours() !== h || date.getUTCMinutes() !== mi
  ) {
    return fail(`"${input}" is not a real date and time. ${START_HELP}`);
  }
  if (date.getTime() <= now.getTime()) return fail(`The start time "${input}" is not in the future. ${START_HELP}`);
  return { ok: true, value: date };
}

const stripInvisible = (s: string): string => s.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "").trim();

export function parseTitle(input: string): Result<string> {
  const t = stripInvisible(input);
  if (t.length === 0) return fail("The title cannot be empty.");
  if (t.length > 100) return fail("The title is too long (max 100 characters).");
  return { ok: true, value: t };
}

export function parseNotes(input: string): Result<string | null> {
  const t = stripInvisible(input);
  if (t.length === 0) return { ok: true, value: null };
  if (t.length > 500) return fail("The notes are too long (max 500 characters).");
  return { ok: true, value: t };
}
