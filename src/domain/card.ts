import type { ContentType, SlotDef } from "./types.ts";
import { MAX_SLOTS } from "./guided.ts";
import { TYPE_LABEL, kindDef, resolveKind } from "./kinds.ts";
import { formatSlotLines } from "./slots.ts";
import { maxPartiesFor, parseCtaSlots } from "./parties.ts";
import { parseGearTier, parseNotes, parseSlots, parseTitle, parseUtcStart } from "./parse.ts";

// The creation card (FR-054, ADR 0032): what the member has set so far, checked as a whole when they press Create.
export type CardInput = {
  type: ContentType | null;
  kind: string;
  title: string | null;
  startText: string | null;
  gearTier: string | null;
  notes: string | null;
  slots: SlotDef[];
  slotsText: string | null; // typed slot lines that did not parse; they win over `slots` until fixed
  // A CTA card (FR-070): no type or category (stored as ZvZ, Other), roles limited to CTA_ROLES, and up to two parties.
  cta?: boolean;
  parties?: number;
  slots2?: SlotDef[];
  slots2Text?: string | null;
  bombers?: number | null; // a CTA's Bombers cap (FR-071)
};

export type CardContent = { type: ContentType; kind: string; title: string; startsAt: Date; tier: string; notes: string | null; slots: SlotDef[]; slots2: SlotDef[]; parties: 1 | 2; bombers: number | null };

// One party of a CTA: typed lines win over stored slots; every role must be a CTA role; an empty party is a problem.
function ctaParty(text: string | null, stored: SlotDef[], party: number, parties: number, problems: string[]): SlotDef[] {
  const label = party === 1 ? "Slots: " : "";
  if (text !== null) {
    const typed = parseCtaSlots(text, party, parties);
    if (typed.ok) return typed.value;
    problems.push(`${label}${typed.error}`);
    return [];
  }
  if (stored.length === 0) {
    problems.push(party === 1 ? "Add the slots: press Roles, type them in Details, or pick a preset." : "Add the slots of party 2: press Party 2 slots.");
  } else if (stored.length > MAX_SLOTS) {
    problems.push(parties > 1 ? `Party ${party} can have at most ${MAX_SLOTS} slots.` : `There can be at most ${MAX_SLOTS} slots.`);
  } else {
    const checked = parseCtaSlots(formatSlotLines(stored), party, parties);
    if (!checked.ok) problems.push(`${label}${checked.error}`);
  }
  return stored;
}

// Every problem at once, in the card's order, so the member can fix them all before the next try.
export function validateCard(c: CardInput, now: Date): { ok: true; value: CardContent } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const cta = c.cta === true;
  const parties: 1 | 2 = cta && (c.parties ?? 1) >= 2 && maxPartiesFor(c.kind ?? "other", true) >= 2 ? 2 : 1;
  const type: ContentType | null = cta ? "zvz" : c.type;
  if (!type) problems.push("Pick the type of content.");
  const kind = cta ? ({ ok: true, value: "other" } as const) : c.type ? resolveKind(c.type, c.kind) : null;
  if (kind && !kind.ok) problems.push(kind.error);
  const title = parseTitle(c.title ?? "");
  if (!title.ok) problems.push(c.title ? title.error : "Add a title in Details.");
  const start = parseUtcStart(c.startText ?? "", now);
  if (!start.ok) problems.push(start.error);
  const tier = parseGearTier(c.gearTier ?? "");
  if (!tier.ok) problems.push(tier.error);
  let slots = c.slots;
  let slots2: SlotDef[] = [];
  if (cta) {
    slots = ctaParty(c.slotsText, c.slots, 1, parties, problems);
    if (parties === 2) slots2 = ctaParty(c.slots2Text ?? null, c.slots2 ?? [], 2, parties, problems);
  } else if (c.slotsText !== null) {
    const typed = parseSlots(c.slotsText);
    if (typed.ok) slots = typed.value;
    else problems.push(`Slots: ${typed.error}`);
  } else if (slots.length === 0) {
    problems.push("Add the slots: press Roles, type them in Details, or pick a preset.");
  } else if (slots.length > MAX_SLOTS) {
    problems.push(`There can be at most ${MAX_SLOTS} slots.`);
  }
  const notes = parseNotes(c.notes ?? "");
  if (!notes.ok) problems.push(notes.error);
  if (problems.length > 0 || !type || !kind?.ok || !title.ok || !start.ok || !tier.ok || !notes.ok) return { ok: false, problems };
  return { ok: true, value: { type, kind: kind.value, title: title.value, startsAt: start.value, tier: tier.value, notes: notes.value, slots, slots2, parties, bombers: cta ? c.bombers ?? null : null } };
}

// A card opened for one forum's type offers that type only (ADR 0037); with none, every type.
export function typesFor(forumType: ContentType | null): ContentType[] {
  return forumType ? [forumType] : ["pvp", "pve", "pvx", "zvz"];
}

// The forum's tags named like the type ("PvP") or the category ("ZvZ"), ignoring case. Discord allows five per post.
export function matchTags(tags: { id: string; name: string }[], type: ContentType, kind: string): string[] {
  const def = kindDef(type, kind);
  const wanted = new Set([TYPE_LABEL[type], ...(def && def.id !== "other" ? [def.label] : [])].map((n) => n.toLowerCase()));
  return tags.filter((t) => wanted.has(t.name.trim().toLowerCase())).map((t) => t.id).slice(0, 5);
}

// Where normal content is posted (ADR 0037): the event forum set for its type, nothing else.
export function pickEventForum<T extends { forumId: string; type: ContentType }>(forums: readonly T[], type: ContentType): T | null {
  return forums.find((f) => f.type === type) ?? null;
}

export type BlankInput = { type: ContentType | null; title: string | null; startText: string | null; gearTier: string | null; notes: string | null };
export type BlankContent = { type: ContentType; title: string; startsAt: Date; tier: string; notes: string | null };

// A blank content (FR-060) has no roster: title, start, gear tier and description. A CTA has no type to pick, so it is ZvZ.
export function validateBlank(c: BlankInput, cta: boolean, now: Date): { ok: true; value: BlankContent } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const type: ContentType | null = c.type ?? (cta ? "zvz" : null);
  if (!type) problems.push("Pick the type of content (PvP or PvE) first.");
  const title = parseTitle(c.title ?? "");
  if (!title.ok) problems.push(c.title ? title.error : "Add a title.");
  const start = parseUtcStart(c.startText ?? "", now);
  if (!start.ok) problems.push(start.error);
  const tier = parseGearTier(c.gearTier ?? "");
  if (!tier.ok) problems.push(tier.error);
  const notes = parseNotes(c.notes ?? "");
  if (!notes.ok) problems.push(notes.error);
  if (problems.length > 0 || !type || !title.ok || !start.ok || !tier.ok || !notes.ok) return { ok: false, problems };
  return { ok: true, value: { type, title: title.value, startsAt: start.value, tier: tier.value, notes: notes.value } };
}
