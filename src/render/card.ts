import type { StoredDraft } from "../db/draft.ts";
import { typesFor } from "../domain/card.ts";
import { DEFAULT_KIND, TYPE_LABEL, kindsOf, kindIcon, typeIcon } from "../domain/kinds.ts";
import { buildRefText } from "../domain/buildref.ts";
import { dutyDef } from "../domain/duties.ts";
import { parseUtcStart } from "../domain/parse.ts";
import type { ContentType } from "../domain/types.ts";
import { IS_COMPONENTS_V2, escapeText, formatUtc } from "./roster.ts";
import { START_MINUTES, dayChoices, startParts } from "../domain/time.ts";
import { roleIcon } from "./theme.ts";

export type CardContext = {
  presets: { id: string; name: string; count: number }[];
  forumType: "pvp" | "pve" | null; // the event forum's type, when the card was opened from its launcher
  problems?: string[];
  note?: string;
  now: Date;
};

// A Components V2 message (ADR 0033): a classic message holds five rows, and the card needs more for the start menus.
// The flag stays on the message, so every later change to it, the slot cards included, is a V2 message too.
export const v2Text = (content: string) => ({ flags: IS_COMPONENTS_V2, components: [{ type: 10, content }], allowed_mentions: { parse: [] as [] } });

const btn = (label: string, emoji: string, custom_id: string, style = 2) => ({ type: 2, style, label, emoji: { name: emoji }, custom_id });
const NONE = "—";

// The creation card (FR-054, ADR 0032): one private message holding everything set so far, with menus that follow
// each other and buttons for the text (Details), the guided slots, the build link, Create and Cancel.
export function renderCard(d: StoredDraft, ctx: CardContext) {
  const id = d.id;
  const start = d.startText ? parseUtcStart(d.startText, new Date(0)) : null;
  const slotLines = d.slotsText !== null
    ? ["⚠️ The typed slots could not be read; fix them in **Details**."]
    : d.slots.map((s, n) => `${n + 1}. ${roleIcon(s.role)} ${escapeText(s.role)}${s.weapon ? ` - ${escapeText(s.weapon)}` : ""}${dutyDef(s.duty) ? ` · ${dutyDef(s.duty)!.icon} ${dutyDef(s.duty)!.label}` : ""}`);
  const lines = [
    `## ${d.type ? kindIcon(d.type, d.kind) : "🛠️"} Create event`,
    `-# Only you see this. Set the menus and the start, then **Details** for the title and gear tier, then **Create**.`,
    `-# 💡 Press **Roles** to build the slots step by step (role, weapon, duty) instead of typing them in **Details**.`,
    `📝 **Title** ${d.title ? escapeText(d.title) : NONE}`,
    `🕰️ **Start** ${start?.ok ? `${formatUtc(start.value)} · <t:${Math.floor(start.value.getTime() / 1000)}:f> your time` : d.startText ? escapeText(d.startText) : NONE}`,
    `⚙️ **Gear tier** ${d.gearTier ? escapeText(d.gearTier) : NONE}`,
    `🗒️ **Notes** ${d.notes ? escapeText(d.notes).slice(0, 300) : NONE}`,
    `🧰 **Build** ${d.buildRef ? buildRefText(d.buildRef, d.guildId) : NONE}`,
    `👥 **Slots (${d.slotsText !== null ? "?" : d.slots.length})**`,
    ...(slotLines.length ? slotLines : [NONE]),
    ...(ctx.problems?.length ? ["", "**Before creating, fix:**", ...ctx.problems.map((p) => `⚠️ ${p}`)] : []),
    ...(ctx.note ? ["", ctx.note] : []),
  ];

  const types = typesFor(ctx.forumType);
  const rows: unknown[] = [
    {
      type: 1,
      components: [{
        type: 3, custom_id: `cc:type:${id}`, placeholder: "Type of content",
        options: types.map((t: ContentType) => ({ label: TYPE_LABEL[t], value: t, emoji: { name: typeIcon(t) }, default: t === d.type })),
      }],
    },
    {
      type: 1,
      components: [{
        type: 3, custom_id: `cc:kind:${id}`,
        placeholder: d.type ? "Category (default Other)" : "Category (pick the type first)",
        disabled: d.type === null,
        options: d.type
          ? kindsOf(d.type).map((k) => ({ label: k.label, value: k.id, emoji: { name: k.id === DEFAULT_KIND ? typeIcon(d.type!) : k.icon }, default: k.id === d.kind }))
          : [{ label: "Pick the type first", value: "-" }],
      }],
    },
    {
      type: 1,
      components: [{
        type: 3, custom_id: `cc:loot:${id}`, placeholder: "Loot vote",
        options: [
          { label: "Loot vote off", value: "0", default: !d.loot },
          { label: "Loot vote on (split or regear)", value: "1", emoji: { name: "💰" }, default: d.loot },
        ],
      }],
    },
    ...startRows(d, ctx.now),
    ...(ctx.presets.length ? [{
      type: 1,
      components: [{
        type: 3, custom_id: `cc:preset:${id}`, placeholder: "Preset (fills the slots)",
        options: ctx.presets.slice(0, 25).map((p) => ({ label: Array.from(p.name).slice(0, 100).join(""), value: p.id, description: `${p.count} positions` })),
      }],
    }] : []),
    {
      type: 1,
      components: [
        btn("Details", "✏️", `cc:details:${id}`, 1),
        btn("Roles", "🧩", `cc:guided:${id}`), // the guided slot cards, named Roles by the owner (2026-10-24)
        btn("Build link", "🧰", `cc:build:${id}`),
        btn("Create", "✅", `cc:create:${id}`, 3),
        btn("Cancel", "✖️", `cc:cancel:${id}`),
      ],
    },
  ];
  return {
    flags: IS_COMPONENTS_V2,
    components: [{ type: 17, components: [{ type: 10, content: lines.join("\n").slice(0, 3000) }, ...rows] }],
    allowed_mentions: { parse: [] as [] },
  };
}

// The start as three menus (ADR 0033): the day (today and the next 13), the hour and the quarter hour, in UTC.
function startRows(d: StoredDraft, now: Date): unknown[] {
  const p = startParts(d.startText);
  const menu = (part: string, placeholder: string, options: { label: string; value: string }[], chosen: string | undefined) => ({
    type: 1,
    components: [{ type: 3, custom_id: `cc:${part}:${d.id}`, placeholder, options: options.map((o) => ({ ...o, default: o.value === chosen })) }],
  });
  return [
    menu("day", "Start day (UTC)", dayChoices(now, p?.day ?? null), p?.day),
    menu("hour", "Start hour (UTC)", Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, "0")}:xx UTC`, value: String(h).padStart(2, "0") })), p?.hour),
    menu("minute", "Start minute", START_MINUTES.map((m) => ({ label: `xx:${m}`, value: m })), p?.minute),
  ];
}

// The pinned launcher post of an event forum (FR-053). The forum's list shows only a post's title and the start of
// its first message, never its buttons, so both say what to do (owner request 2026-10-24, ADR 0033).
export const LAUNCHER_NAME = "📌 Create an event: click here";
export function renderLauncher() {
  return {
    content: [
      "👉 Press **Create event** below to set up your event.",
      "Pick the type and category, the start, the details and the slots, then **Create**. The bot makes the event's own post in this forum.",
    ].join("\n"),
    components: [{ type: 1, components: [{ type: 2, style: 3, label: "Create event", emoji: { name: "✨" }, custom_id: "lc:create" }] }],
    allowed_mentions: { parse: [] as [] },
  };
}
