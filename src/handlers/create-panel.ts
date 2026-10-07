import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { KINDS, DEFAULT_KIND, resolveKind } from "../domain/kinds.ts";
import { formatSlotLines } from "../domain/slots.ts";
import { getPresetById, listPresets } from "../db/preset.ts";
import type { ContentType } from "../domain/types.ts";
import { createForm, forumType, postTakenReply } from "./create.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = "That panel is out of date. Run `/content create` again.";
const NOT_FORUM = "Use this command inside a post in the PvP or PvE content forum.";

// The draft lives in the custom ids of the panel's components, so nothing is kept in memory.
export type CreateDraft = { loot: boolean; kind: string; presetId: string | null };
export const DEFAULT_DRAFT: CreateDraft = { loot: false, kind: DEFAULT_KIND, presetId: null };

const encode = (d: CreateDraft) => `${d.loot ? 1 : 0}:${d.kind}:${d.presetId ?? "-"}`;

function decode(parts: string[]): CreateDraft | null {
  const [loot, kind, preset] = parts;
  if ((loot !== "0" && loot !== "1") || !kind || !/^[a-z-]{1,30}$/.test(kind)) return null;
  if (preset !== "-" && !(preset && UUID.test(preset))) return null;
  return { loot: loot === "1", kind, presetId: preset === "-" ? null : preset! };
}

export async function createPanel(
  deps: Deps,
  guildId: string,
  type: ContentType,
  draft: CreateDraft,
  mode: "new" | "update",
): Promise<InteractionResponse> {
  const presets = await listPresets(deps.sql, guildId);
  const suffix = encode(draft);
  const rows: unknown[] = [
    {
      type: 1,
      components: [{
        type: 3, custom_id: `cp:kind:${suffix}`, placeholder: "Kind of content",
        options: KINDS.filter((k) => k.type === type).map((k) => ({
          label: k.label, value: k.id, default: k.id === draft.kind,
        })),
      }],
    },
    {
      type: 1,
      components: [{
        type: 3, custom_id: `cp:loot:${suffix}`, placeholder: "Loot vote",
        options: [
          { label: "Loot vote: Off", value: "0", default: !draft.loot },
          { label: "Loot vote: On (split or regear)", value: "1", default: draft.loot },
        ],
      }],
    },
  ];
  if (presets.length > 0) {
    rows.push({
      type: 1,
      components: [{
        type: 3, custom_id: `cp:preset:${suffix}`, placeholder: "Preset (optional)", min_values: 0, max_values: 1,
        options: presets.slice(0, 25).map((p) => ({
          label: Array.from(p.name).slice(0, 100).join(""), value: p.id, default: p.id === draft.presetId,
        })),
      }],
    });
  }
  rows.push({
    type: 1,
    components: [{ type: 2, style: 3, label: "Continue", custom_id: `cpgo:${suffix}` }],
  });
  const data = {
    content: "**Create content**\nPick the options, then press Continue to enter the title, time, tier and slots.",
    components: rows,
    allowed_mentions: { parse: [] },
  };
  return mode === "new"
    ? { type: CHANNEL_MESSAGE, data: { ...data, flags: EPHEMERAL } }
    : { type: UPDATE_MESSAGE, data };
}

// A menu in the panel changed: rebuild the panel with the new choice.
export async function handleCreatePanel(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown; values?: unknown } | undefined);
  const parts = typeof raw?.custom_id === "string" ? raw.custom_id.split(":") : [];
  const field = parts[1];
  const draft = decode(parts.slice(2));
  const values = Array.isArray(raw?.values) ? (raw!.values as unknown[]) : null;
  const type = await forumType(deps, i);
  if (parts[0] !== "cp" || !draft || !values || !i.guild_id || values.length > 1) return reply(INVALID);
  if (type === null) return reply(NOT_FORUM);
  const value = values[0];

  if (field === "kind") {
    const kind = typeof value === "string" ? resolveKind(type, value) : null;
    if (!kind?.ok) return reply(INVALID);
    draft.kind = kind.value;
  } else if (field === "loot") {
    if (value !== "0" && value !== "1") return reply(INVALID);
    draft.loot = value === "1";
  } else if (field === "preset") {
    if (value === undefined) {
      draft.presetId = null;
    } else {
      if (typeof value !== "string" || !UUID.test(value) || !(await getPresetById(deps.sql, i.guild_id, value))) {
        return reply(INVALID);
      }
      draft.presetId = value;
    }
  } else {
    return reply(INVALID);
  }
  return await createPanel(deps, i.guild_id, type, draft, "update");
}

// Continue: open the form, with the slots filled in when a preset was chosen.
export async function handleCreateContinue(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const parts = typeof raw === "string" ? raw.split(":") : [];
  const draft = parts[0] === "cpgo" ? decode(parts.slice(1)) : null;
  if (!draft || !i.guild_id) return reply(INVALID);
  const type = await forumType(deps, i);
  if (type === null) return reply(NOT_FORUM);
  const kind = resolveKind(type, draft.kind);
  if (!kind.ok) return reply(kind.error);
  if (i.channel?.id) {
    const taken = await postTakenReply(deps, i.guild_id, i.channel.id);
    if (taken) return taken;
  }
  let lines: string | null = null;
  if (draft.presetId) {
    const preset = await getPresetById(deps.sql, i.guild_id, draft.presetId);
    if (!preset) return reply("That preset no longer exists. Run `/content create` again.");
    lines = formatSlotLines(preset.slots);
  }
  return createForm({ ...draft, kind: kind.value }, lines);
}
