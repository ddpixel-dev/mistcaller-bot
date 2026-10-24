import type { StoredDraft } from "../db/draft.ts";
import { typesFor } from "../domain/card.ts";
import { DEFAULT_KIND, TYPE_LABEL, kindsOf, kindIcon, typeIcon } from "../domain/kinds.ts";
import { buildRefText } from "../domain/buildref.ts";
import { dutyDef } from "../domain/duties.ts";
import { parseUtcStart } from "../domain/parse.ts";
import type { ContentType } from "../domain/types.ts";
import { escapeText, formatUtc } from "./roster.ts";
import { roleIcon } from "./theme.ts";

export type CardContext = {
  presets: { id: string; name: string; count: number }[];
  forumType: "pvp" | "pve" | null; // the event forum's type, when the card was opened from its launcher
  problems?: string[];
  note?: string;
};

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
    `-# Only you see this. Set the menus, then **Details** for the text, then **Create**.`,
    `📝 **Title** ${d.title ? escapeText(d.title) : NONE}`,
    `🕰️ **Start** ${start?.ok ? formatUtc(start.value) : d.startText ? escapeText(d.startText) : NONE}`,
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
        btn("Guided slots", "🧩", `cc:guided:${id}`),
        btn("Build link", "🧰", `cc:build:${id}`),
        btn("Create", "✅", `cc:create:${id}`, 3),
        btn("Cancel", "✖️", `cc:cancel:${id}`),
      ],
    },
  ];
  return { content: lines.join("\n").slice(0, 2000), embeds: [], components: rows, allowed_mentions: { parse: [] as [] } };
}

// The pinned launcher post of an event forum (FR-053).
export const LAUNCHER_NAME = "📌 Create an event";
export function renderLauncher() {
  return {
    content: [
      "## 📌 Create an event",
      "Press **Create event** to set up a roster. Pick the type and category, add the details and the slots, then **Create**.",
      "The bot makes the event's own post in this forum, so posts here are always rosters.",
    ].join("\n"),
    components: [{ type: 1, components: [{ type: 2, style: 3, label: "Create event", emoji: { name: "✨" }, custom_id: "lc:create" }] }],
    allowed_mentions: { parse: [] as [] },
  };
}
