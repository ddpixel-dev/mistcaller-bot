import type { StoredDraft } from "../db/draft.ts";
import { typesFor, validateCard } from "../domain/card.ts";
import { DEFAULT_KIND, TYPE_LABEL, kindsOf, kindIcon, typeIcon } from "../domain/kinds.ts";
import { buildRefText } from "../domain/buildref.ts";
import { dutyDef } from "../domain/duties.ts";
import { parseUtcStart } from "../domain/parse.ts";
import { CTA_ROLES, ONE_PARTY_EMOJI, ONE_PARTY_LABEL, PARTIES_PLACEHOLDER, TWO_PARTIES_EMOJI, TWO_PARTIES_LABEL, maxPartiesFor } from "../domain/parties.ts";
import type { SlotDef } from "../domain/types.ts";
import type { ContentType } from "../domain/types.ts";
import { IS_COMPONENTS_V2, escapeText, formatUtc, massingText } from "./roster.ts";
import { roleIcon } from "./theme.ts";

export type CardContext = {
  presets: { id: string; name: string; count: number }[];
  forumType: ContentType | null; // the event forum's type, when the card was opened from its launcher
  problems?: string[];
  note?: string;
  now: Date;
};

// A Components V2 message (ADR 0033): it can hold the tips under the buttons. The flag stays on the message, so every
// later change to it, the slot cards included, is a V2 message too.
export const v2Text = (content: string) => ({ flags: IS_COMPONENTS_V2, components: [{ type: 10, content }], allowed_mentions: { parse: [] as [] } });

const btn = (label: string, emoji: string, custom_id: string, style = 2) => ({ type: 2, style, label, emoji: { name: emoji }, custom_id });
const NONE = "—";

// The creation card (FR-054, ADR 0032): one private message holding everything set so far, with menus that follow
// each other and buttons for the text (Details), the guided slots, the build link, Create and Cancel.
export function renderCard(d: StoredDraft, ctx: CardContext) {
  const id = d.id;
  const start = d.startText ? parseUtcStart(d.startText, new Date(0)) : null;
  // Create is dimmed until the card passes the same checks as creation (owner request 2026-10-24, ADR 0034); the card
  // says what is still needed. Problems from the last action (a slot line that did not parse) come first.
  const checked = validateCard(d, ctx.now);
  const needed = [...new Set([...(ctx.problems ?? []), ...(checked.ok ? [] : checked.problems)])];
  const ctaParties = d.cta && maxPartiesFor(d.kind, true) > 1; // the Parties menu is offered
  const two = ctaParties && d.parties >= 2;
  const lineOf = (s: SlotDef, n: number) => `${n + 1}. ${roleIcon(s.role)} ${escapeText(s.role)}${s.weapon ? ` - ${escapeText(s.weapon)}` : ""}${dutyDef(s.duty) ? ` · ${dutyDef(s.duty)!.icon} ${dutyDef(s.duty)!.label}` : ""}`;
  const slotBlock = (title: string, slots: SlotDef[], typed: string | null, where: string) => [
    `👥 **${title} (${typed !== null ? "?" : slots.length})**`,
    ...(typed !== null ? [`⚠️ The typed slots could not be read; fix them in **${where}**.`] : slots.length ? slots.map(lineOf) : [NONE]),
  ];
  const lines = [
    `## ${d.cta ? "📣" : d.type ? kindIcon(d.type, d.kind) : "🛠️"} Create ${d.cta ? "CTA (call to arms)" : "event"}`,
    `📝 **Title** ${d.title ? escapeText(d.title) : NONE}`,
    `🕰️ **Start** ${start?.ok ? `${formatUtc(start.value)} · <t:${Math.floor(start.value.getTime() / 1000)}:f> your time` : d.startText ? escapeText(d.startText) : NONE}`,
    `⚙️ **Gear tier** ${d.gearTier ? escapeText(d.gearTier) : NONE}`,
    `📍 **Massing at** ${d.massing ? massingText(d.massing) : NONE}`,
    `🗒️ **Notes** ${d.notes ? escapeText(d.notes).slice(0, 300) : NONE}`,
    `🧰 **Build** ${d.buildRef ? buildRefText(d.buildRef, d.guildId) : NONE}`,
    `🎯 **Sign-up** ${d.selection ? "Selection: players apply and you pick the party" : "Open: players take their own position"}`,
    ...(d.cta ? [`💣 **Bombers** ${d.bombers ? `up to ${d.bombers}` : NONE}`, `-# Roles: ${CTA_ROLES.join(", ")}`] : []),
    ...(two
      ? [...slotBlock("Party 1", d.slots, d.slotsText, "Party 1 slots"), ...slotBlock("Party 2", d.slots2, d.slots2Text, "Party 2 slots"),
        "-# Roles fills party 1; use Party 2 slots for the second party."]
      : slotBlock("Slots", d.slots, d.slotsText, d.cta ? "Slots" : "Details")),
    ...(needed.length ? ["", "**Still needed before Create:**", ...needed.map((p) => `⚠️ ${p}`)] : ["", "✅ Ready: press **Create**."]),
    ...(ctx.note ? ["", ctx.note] : []),
  ];

  const types = typesFor(ctx.forumType);
  const rows: unknown[] = [
    {
      type: 1,
      components: [ctx.presets.length
        ? {
          type: 3, custom_id: `cc:preset:${id}`, placeholder: "Choose from preset (fills the whole card)",
          options: ctx.presets.slice(0, 25).map((p) => ({ label: Array.from(p.name).slice(0, 100).join(""), value: p.id, description: `${p.count} positions` })),
        }
        // Always shown and first (owner request 2026-11-07): with no presets it is dimmed and says how to save one.
        : {
          type: 3, custom_id: `cc:preset:${id}`, placeholder: "Preset: none saved yet", disabled: true,
          options: [{ label: "No presets yet: save one with /content preset save", value: NO_PRESET }],
        }],
    },
    // A CTA has no type or category (it is ZvZ, Other); it has the Parties choice instead (FR-070).
    ...(d.cta ? (ctaParties ? [{
      type: 1,
      components: [{
        type: 3, custom_id: `cc:parties:${id}`, placeholder: PARTIES_PLACEHOLDER,
        options: [
          { label: ONE_PARTY_LABEL, value: "1", emoji: { name: ONE_PARTY_EMOJI }, default: !two },
          { label: TWO_PARTIES_LABEL, value: "2", emoji: { name: TWO_PARTIES_EMOJI }, default: two },
        ],
      }],
    }] : []) : [
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
    ]),
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
    {
      type: 1,
      components: [{
        type: 3, custom_id: `cc:sel:${id}`, placeholder: "Sign-up",
        options: [
          { label: "Open sign-up", value: "0", default: !d.selection },
          { label: "Selection (you pick the party)", value: "1", emoji: { name: "🎯" }, default: d.selection },
        ],
      }],
    },
    {
      type: 1,
      components: [
        btn("Blank template", "📄", `cc:blank:${id}`), // FR-060: skip the roster, go to the final form
        btn("Manage presets", "💾", `cc:presets:${id}`), // ADR 0039: admins save the card as a preset or delete one
        btn("Massing at", "📍", `cc:massing:${id}`), // FR-074: where the party gathers
      ],
    },
    // A CTA keeps the card's text in Details (title, start, tier, notes, Bombers) and each party's slots in its own button
    // (owner request 2026-11-11); normal content has the slots in Details as before.
    ...(d.cta
      ? [
        {
          type: 1,
          components: [
            btn("Details", "✏️", `cc:details:${id}`, 1),
            btn(two ? "Party 1 slots" : "Slots", "👥", `cc:p1:${id}`, 1),
            ...(two ? [btn("Party 2 slots", "👥", `cc:p2:${id}`, 1), btn("Copy party 1", "📋", `cc:copy:${id}`)] : []),
            btn("Roles", "🧩", `cc:guided:${id}`),
          ],
        },
        {
          type: 1,
          components: [
            btn("Build link", "🧰", `cc:build:${id}`),
            { ...btn("Create", "✅", `cc:create:${id}`, 3), disabled: needed.length > 0 },
            btn("Cancel", "✖️", `cc:cancel:${id}`),
          ],
        },
      ]
      : [{
        type: 1,
        components: [
          btn("Details", "✏️", `cc:details:${id}`, 1),
          btn("Roles", "🧩", `cc:guided:${id}`), // the guided slot cards, named Roles by the owner (2026-10-24)
          btn("Build link", "🧰", `cc:build:${id}`),
          { ...btn("Create", "✅", `cc:create:${id}`, 3), disabled: needed.length > 0 },
          btn("Cancel", "✖️", `cc:cancel:${id}`),
        ],
      }]),
  ];
  return {
    flags: IS_COMPONENTS_V2,
    components: [{
      type: 17,
      components: [{ type: 10, content: lines.join("\n").slice(0, 3000) }, ...rows, { type: 14, divider: true, spacing: 2 }, { type: 10, content: CARD_TIPS }],
    }],
    allowed_mentions: { parse: [] as [] },
  };
}

// The tips sit under the buttons, one per line (owner request 2026-10-24, ADR 0034).
// The value of the placeholder option of the dimmed Preset menu; it is never a preset id.
export const NO_PRESET = "-";

export const CARD_TIPS = [
  "-# 💡 Only you see this card.",
  "-# 💡 Pick a preset to fill the whole card at once, or set the type, category and loot vote, then press **Details** for the title, start time, gear tier and notes.",
  "-# 💡 Press **Roles** to build the slots step by step (role, weapon, duty) instead of typing them in **Details**.",
  "-# 💡 **Blank template** is a quick event without a roster: only a title, start, gear tier and description.",
  "-# 💡 Admins: **Manage presets** saves this card as a preset (once it is valid) or deletes one.",
  "-# 💡 **Create** lights up once everything needed is set.",
].join("\n");
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

// The Manage presets panel (ADR 0039): it replaces the card in the same message, with Back to return. Admins only (the handler checks).
export type PresetView =
  | { kind: "main"; ready: boolean; problems: string[]; hasPresets: boolean; note?: string }
  | { kind: "pick"; presets: { id: string; name: string; count: number }[] }
  | { kind: "confirm"; presetId: string; name: string };

export function renderPresetPanel(id: string, v: PresetView) {
  const body: unknown[] = [];
  if (v.kind === "main") {
    body.push(
      { type: 10, content: [
        "## 💾 Manage presets",
        ...(v.note ? [v.note, ""] : []),
        "**Save as preset** saves this card as it is now, if it is valid (the same checks as Create): type, category, loot vote, sign-up, title, gear tier, notes, build link and positions. The start time is not saved.",
        "**Delete preset** removes a saved preset, after you confirm.",
        ...(v.ready ? [] : ["", "⚠️ **The card is not ready to save yet:**", ...v.problems.map((p) => `⚠️ ${p}`)]),
      ].join("\n").slice(0, 3000) },
      { type: 1, components: [
        { ...btn("Save as preset", "💾", `cc:savepreset:${id}`, 1), disabled: !v.ready },
        { ...btn("Delete preset", "🗑️", `cc:delpreset:${id}`), disabled: !v.hasPresets },
        btn("Back to the card", "↩️", `cc:back:${id}`),
      ] },
    );
  } else if (v.kind === "pick") {
    body.push(
      { type: 10, content: "## 🗑️ Delete a preset\nChoose the preset to delete. You will be asked to confirm." },
      { type: 1, components: [{
        type: 3, custom_id: `cc:delpick:${id}`, placeholder: "Choose the preset to delete",
        options: v.presets.slice(0, 25).map((p) => ({ label: Array.from(p.name).slice(0, 100).join(""), value: p.id, description: `${p.count} positions` })),
      }] },
      { type: 1, components: [btn("Back", "↩️", `cc:presets:${id}`)] },
    );
  } else {
    body.push(
      { type: 10, content: `## 🗑️ Delete the preset **${v.name}**?\nThis cannot be undone.` },
      { type: 1, components: [btn("Delete", "🗑️", `cc:delyes:${id}:${v.presetId}`, 4), btn("Keep it", "↩️", `cc:presets:${id}`)] },
    );
  }
  return { flags: IS_COMPONENTS_V2, components: [{ type: 17, components: body }], allowed_mentions: { parse: [] as [] } };
}
