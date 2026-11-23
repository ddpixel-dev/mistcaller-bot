import type { Result, SlotDef, SlotMode } from "./types.ts";
import { DUTIES } from "./duties.ts";
import { ROLES_TEXT, canonicalRole, canonicalWeapon, weaponHint } from "./terms.ts";

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

type Existing = { role: string; weapon?: string | null; duty?: string | null };

// FR-003, FR-076, FR-077: one slot per line. Role mode: `Role`, `Role (Duty)`, `Role - Weapon` or `Role - Weapon (Duty)`.
// Weapon mode: `Weapon` or `Weapon (Duty)`. The role must be one of five and the weapon from the game's list, stored in the
// list's spelling. `existing` are the slots the content has now: a line equal to one of them is kept as it is, unchecked,
// so a roster made before the checks can still be edited.
export function parseSlots(input: string, mode: SlotMode = "role", existing: readonly Existing[] = []): Result<SlotDef[]> {
  const lines = input.split(/\r?\n/).map((l, i) => ({ text: l.trim(), n: i + 1 })).filter((l) => l.text !== "");
  const example = mode === "weapon" ? "Hallowfall (Main Healer)" : "Tank - Mace";
  if (lines.length === 0) return fail(`Add at least one slot, one per line, like: ${example}`);
  if (lines.length > 20) return fail(`Too many slots (${lines.length}). The maximum is 20.`);
  const slots: SlotDef[] = [];
  for (const { text, n } of lines) {
    // The duty is an optional bracket at the end: "Tank - Mace (Caller)", "Tank (Caller)", "Bow (Caller)".
    let duty: string | null = null;
    let body = text;
    const bracket = /\s*\(([^()]*)\)\s*$/.exec(text);
    if (bracket) {
      const found = DUTIES.find((d) => d.label.toLowerCase() === bracket[1]!.trim().toLowerCase());
      if (!found) return fail(`Unknown duty "${bracket[1]!.trim()}" on line ${n}. Use ${DUTIES.map((d) => d.label).join(", ")}.`);
      duty = found.id;
      body = text.slice(0, bracket.index).trim();
    }
    let role = "";
    let weapon = "";
    if (mode === "weapon") {
      if (/\s[-–]\s/.test(body)) return fail(`Line ${n}: this content's slots are by weapon: write one weapon per line, like ${example}.`);
      weapon = body;
      if (!weapon) return fail(`Slot on line ${n} needs a weapon, like: ${example}`);
    } else {
      // Prefer the first spaced separator; else the first bare dash. A role alone is allowed: the player brings the
      // weapon of their choice (FR-030).
      const spaced = /\s[-–]\s/.exec(body);
      const idx = spaced ? spaced.index + 1 : body.search(/[-–]/);
      role = idx < 0 ? body : body.slice(0, idx).trim();
      weapon = idx < 0 ? "" : body.slice(idx + 1).trim();
      if (!role) return fail(`Slot on line ${n} needs a role, like: Tank - Mace, or just Tank`);
    }
    if (role.length > 30) return fail(`Role on line ${n} is too long (max 30 characters).`);
    if (weapon.length > 40) return fail(`Weapon on line ${n} is too long (max 40 characters).`);
    const kept = existing.some((e) => e.role === role && (e.weapon ?? "") === weapon && (e.duty ?? null) === duty);
    if (!kept) {
      if (role) {
        const r = canonicalRole(role);
        if (!r) return fail(`Line ${n}: "${role}" is not a supported role. Use ${ROLES_TEXT}.`);
        role = r;
      }
      if (weapon) {
        const w = canonicalWeapon(weapon);
        if (!w) return fail(`Line ${n}: "${weapon}" is not a weapon.${weaponHint(weapon)}`);
        weapon = w;
      }
    }
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
