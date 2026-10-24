import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, MODAL, reply } from "../discord/response.ts";
import { labelled, modalPicks, modalValues } from "../discord/modal.ts";
import { DEFAULT_KIND, KINDS, TYPE_LABEL, typeIcon, type KindDef } from "../domain/kinds.ts";
import { packRef, unpackRef } from "../domain/buildref.ts";
import { parseGearTier } from "../domain/parse.ts";
import type { ContentType } from "../domain/types.ts";
import { listPresets, getPresetById } from "../db/preset.ts";
import { getDraft, startDraft } from "../db/draft.ts";
import { renderGuidedStep } from "../render/guided.ts";
import { NOT_HERE, placeProblem, postTakenReply } from "./create.ts";

const INVALID = "That form is out of date. Run `/content create` again.";
const MAX_PLAYERS = 20;

// The first create form (owner decision 2026-10-24, ADR 0031): everything chosen before the slots, in one form.
// A form holds five fields, and a menu in a form cannot change with another, so the type and the category share
// one menu ("pvp:zvz"). PvX starts without a category; Manage, then Edit, can give it one.
type Choice = { value: string; label: string; emoji: string };
export function typeCategoryChoices(): Choice[] {
  const of = (type: "pvp" | "pve") => KINDS.filter((k) => k.type === type);
  const choice = (k: KindDef): Choice => ({ value: `${k.type}:${k.id}`, label: `${TYPE_LABEL[k.type]} · ${k.label}`, emoji: k.id === DEFAULT_KIND ? typeIcon(k.type) : k.icon });
  const cats = (type: "pvp" | "pve") => of(type).filter((k) => k.id !== DEFAULT_KIND).map(choice);
  const other = (type: "pvp" | "pve") => of(type).filter((k) => k.id === DEFAULT_KIND).map(choice);
  return [...cats("pvp"), ...cats("pve"), ...other("pvp"), ...other("pve"), { value: `pvx:${DEFAULT_KIND}`, label: "PvX", emoji: typeIcon("pvx") }];
}

export type FirstFormDefaults = { type?: ContentType; kind?: string; count?: number | null; gearTier?: string | null; loot?: boolean };

export async function firstForm(deps: Deps, guildId: string, buildRef: string | null, d: FirstFormDefaults = {}): Promise<InteractionResponse> {
  const presets = (await listPresets(deps.sql, guildId)).slice(0, 25);
  const chosen = d.type ? `${d.type}:${d.kind ?? DEFAULT_KIND}` : null;
  const components: unknown[] = [
    labelled("Type and category", {
      type: 3, custom_id: "kind", placeholder: "PvP · ZvZ, PvE · Mists, …",
      options: typeCategoryChoices().map((c) => ({ label: c.label, value: c.value, emoji: { name: c.emoji }, default: c.value === chosen })),
    }),
    labelled("Players needed", {
      type: 3, custom_id: "count", placeholder: "1 to 20", required: false,
      options: Array.from({ length: MAX_PLAYERS }, (_, n) => ({ label: String(n + 1), value: String(n + 1), default: n + 1 === d.count })),
    }, presets.length ? "Not needed when you pick a preset" : undefined),
    ...(presets.length ? [labelled("Preset (optional)", {
      type: 3, custom_id: "preset", placeholder: "Start from saved slots", required: false,
      options: presets.map((p) => ({ label: Array.from(p.name).slice(0, 100).join(""), value: p.id, description: `${p.slots.length} positions` })),
    })] : []),
    labelled("Gear tier", {
      type: 4, custom_id: "tier", style: 1, max_length: 80, required: true, placeholder: "Weapon T7.1 - Gear T4.3",
      ...(d.gearTier ? { value: d.gearTier } : {}),
    }),
    labelled("Loot vote", {
      type: 3, custom_id: "loot",
      options: [
        { label: "Off", value: "0", default: d.loot !== true },
        { label: "On (split or regear)", value: "1", emoji: { name: "💰" }, default: d.loot === true },
      ],
    }),
  ];
  return { type: MODAL, data: { custom_id: `cf${buildRef ? `:${packRef(buildRef)}` : ""}`, title: "Create content", components } };
}

// cf[:<build>]: the first form was sent. A preset loads its slots and offers the final form; otherwise the slot cards
// start, sized to the number of players.
export async function handleFirstFormModal(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const parts = typeof raw === "string" ? raw.split(":") : [];
  const userId = i.member?.user?.id;
  const threadId = i.channel?.id;
  if (parts[0] !== "cf" || parts.length > 2) return reply(INVALID);
  if (!i.guild_id || !userId || !threadId) return reply(NOT_HERE);
  const problem = placeProblem(i);
  if (problem) return reply(problem);
  const taken = await postTakenReply(deps, i.guild_id, threadId);
  if (taken) return taken;
  const buildRef = parts[1] === undefined ? null : unpackRef(parts[1]);
  if (parts[1] !== undefined && buildRef === null) return reply(INVALID);

  const picks = modalPicks(i);
  const choice = typeCategoryChoices().find((c) => c.value === picks.kind?.[0]);
  if (!choice) return reply(INVALID);
  const [type, kind] = choice.value.split(":") as [ContentType, string];
  const loot = picks.loot?.[0] === "1";
  const tier = parseGearTier(modalValues(i).tier ?? "");
  if (!tier.ok) return reply(tier.error);
  const base = { guildId: i.guild_id, userId, threadId, type, kind, loot, buildRef, gearTier: tier.value };

  const presetId = picks.preset?.[0];
  if (presetId) {
    const preset = await getPresetById(deps.sql, i.guild_id, presetId);
    if (!preset) return reply("That preset no longer exists. Run `/content create` again.");
    const id = await startDraft(deps.sql, { ...base, slots: preset.slots.slice(0, MAX_PLAYERS) });
    // A form cannot open another form, so a button opens the final one.
    return {
      type: CHANNEL_MESSAGE,
      data: {
        content: `📋 Preset **${preset.name.replace(/[*_`~|\\]/g, "")}** loaded (${Math.min(preset.slots.length, MAX_PLAYERS)} positions). Open the form to finish.`,
        flags: EPHEMERAL,
        allowed_mentions: { parse: [] },
        components: [{
          type: 1,
          components: [
            { type: 2, style: 3, label: "Open form", custom_id: `gs:done:${id}` },
            { type: 2, style: 2, label: "Cancel", custom_id: `gs:cancel:${id}` },
          ],
        }],
      },
    };
  }
  const n = Number(picks.count?.[0]);
  const count = Number.isInteger(n) && n >= 1 && n <= MAX_PLAYERS ? n : null; // no number: the first card asks for it
  const id = await startDraft(deps.sql, { ...base, count });
  const d = await getDraft(deps.sql, id, deps.now());
  if (!d) return reply(INVALID);
  return { type: CHANNEL_MESSAGE, data: { ...renderGuidedStep(d), flags: EPHEMERAL } };
}

// A click on the create panel of an earlier version (cp, cpgo, cpx): it no longer exists.
export async function handleOldCreatePanel(): Promise<InteractionResponse> {
  return reply("This panel is from an earlier version. Run `/content create` again.");
}
