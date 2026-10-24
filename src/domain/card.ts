import type { ContentType, SlotDef } from "./types.ts";
import { MAX_SLOTS } from "./guided.ts";
import { TYPE_LABEL, kindDef, resolveKind } from "./kinds.ts";
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
};

export type CardContent = { type: ContentType; kind: string; title: string; startsAt: Date; tier: string; notes: string | null; slots: SlotDef[] };

// Every problem at once, in the card's order, so the member can fix them all before the next try.
export function validateCard(c: CardInput, now: Date): { ok: true; value: CardContent } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (!c.type) problems.push("Pick the type of content.");
  const kind = c.type ? resolveKind(c.type, c.kind) : null;
  if (kind && !kind.ok) problems.push(kind.error);
  const title = parseTitle(c.title ?? "");
  if (!title.ok) problems.push(c.title ? title.error : "Add a title in Details.");
  const start = parseUtcStart(c.startText ?? "", now);
  if (!start.ok) problems.push(start.error);
  const tier = parseGearTier(c.gearTier ?? "");
  if (!tier.ok) problems.push(tier.error);
  let slots = c.slots;
  if (c.slotsText !== null) {
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
  if (problems.length > 0 || !c.type || !kind?.ok || !title.ok || !start.ok || !tier.ok || !notes.ok) return { ok: false, problems };
  return { ok: true, value: { type: c.type, kind: kind.value, title: title.value, startsAt: start.value, tier: tier.value, notes: notes.value, slots } };
}

// A forum's type limits the content types offered (owner decision 2026-10-24): PvX fits either, null means any.
export function typesFor(forumType: "pvp" | "pve" | null): ContentType[] {
  return forumType ? [forumType, "pvx"] : ["pvp", "pve", "pvx"];
}

// The forum's tags named like the type ("PvP") or the category ("ZvZ"), ignoring case. Discord allows five per post.
export function matchTags(tags: { id: string; name: string }[], type: ContentType, kind: string): string[] {
  const def = kindDef(type, kind);
  const wanted = new Set([TYPE_LABEL[type], ...(def && def.id !== "other" ? [def.label] : [])].map((n) => n.toLowerCase()));
  return tags.filter((t) => wanted.has(t.name.trim().toLowerCase())).map((t) => t.id).slice(0, 5);
}
