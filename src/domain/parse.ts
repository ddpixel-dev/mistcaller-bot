import type { Result, SlotDef, Tier, TierRange } from "./types.ts";

const TIER_HELP = "Use a tier like T5.3 or a range like T5.3-T7.0 (tier 1-8, enchant 0-4).";
const START_HELP = "Use the format YYYY-MM-DD HH:MM in UTC, in the future, for example 2026-10-07 18:00.";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function parseOneTier(s: string): Tier | null {
  const m = /^[Tt]([1-9])\.([0-9])$/.exec(s.trim());
  if (!m) return null;
  const tier = Number(m[1]);
  const enchant = Number(m[2]);
  if (tier < 1 || tier > 8 || enchant > 4) return null;
  return { tier, enchant };
}

export function parseTier(input: string): Result<TierRange> {
  const parts = input.trim().split(/[-–]/);
  if (parts.length > 2) return fail(`Invalid tier "${input}". ${TIER_HELP}`);
  const min = parseOneTier(parts[0]!);
  if (!min) return fail(`Invalid tier "${input}". ${TIER_HELP}`);
  if (parts.length === 1) return { ok: true, value: { min, max: null } };
  const max = parseOneTier(parts[1]!);
  if (!max) return fail(`Invalid tier "${input}". ${TIER_HELP}`);
  if (max.tier * 10 + max.enchant < min.tier * 10 + min.enchant) {
    return fail(`The range "${input}" runs backwards, put the lower tier first. ${TIER_HELP}`);
  }
  return { ok: true, value: { min, max } };
}

const fmt = (t: Tier): string => `T${t.tier}.${t.enchant}`;

export function formatTier(r: TierRange): string {
  return r.max ? `${fmt(r.min)}–${fmt(r.max)}` : fmt(r.min);
}

export function parseSlots(input: string): Result<SlotDef[]> {
  const lines = input.split(/\r?\n/).map((l, i) => ({ text: l.trim(), n: i + 1 })).filter((l) => l.text !== "");
  if (lines.length === 0) return fail("Add at least one slot, one per line, like: Tank - Great Axe");
  if (lines.length > 20) return fail(`Too many slots (${lines.length}). The maximum is 20.`);
  const slots: SlotDef[] = [];
  for (const { text, n } of lines) {
    const idx = text.search(/[-–]/);
    if (idx < 0) return fail(`Slot on line ${n} needs a role and a weapon separated by a dash, like: Tank - Great Axe`);
    const role = text.slice(0, idx).trim();
    const weapon = text.slice(idx + 1).trim();
    if (!role || !weapon) return fail(`Slot on line ${n} needs both a role and a weapon, like: Tank - Great Axe`);
    if (role.length > 30) return fail(`Role on line ${n} is too long (max 30 characters).`);
    if (weapon.length > 40) return fail(`Weapon on line ${n} is too long (max 40 characters).`);
    slots.push({ role, weapon });
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

export function parseTitle(input: string): Result<string> {
  const t = input.trim();
  if (t.length === 0) return fail("The title cannot be empty.");
  if (t.length > 100) return fail("The title is too long (max 100 characters).");
  return { ok: true, value: t };
}

export function parseNotes(input: string): Result<string | null> {
  const t = input.trim();
  if (t.length === 0) return { ok: true, value: null };
  if (t.length > 500) return fail("The notes are too long (max 500 characters).");
  return { ok: true, value: t };
}
