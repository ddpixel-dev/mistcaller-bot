import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { KINDS, DEFAULT_KIND, kindDef, resolveKind } from "../domain/kinds.ts";
import { formatSlotLines } from "../domain/slots.ts";
import { getPresetById, listPresets } from "../db/preset.ts";
import type { ContentType } from "../domain/types.ts";
import { createForm, inContentPost, postTakenReply } from "./create.ts";
import { deleteDraft, findDraft } from "../db/draft.ts";
import { startGuided } from "./guided.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = "That panel is out of date. Run `/content create` again.";
const NOT_FORUM = "Use this command inside a post in a content forum.";
const NEED_TYPE = "Pick the type of content first.";

// The draft lives in the custom ids of the panel's components, so nothing is kept in memory.
// Every field starts unset (shown as "-" in the ids) so the boxes show what they are for.
export type CreateDraft = { type: ContentType | null; loot: boolean | null; kind: string | null; presetId: string | null };
export const DEFAULT_DRAFT: CreateDraft = { type: null, loot: null, kind: null, presetId: null };

export const encode = (d: CreateDraft) =>
  `${d.type ?? "-"}:${d.loot === null ? "-" : d.loot ? 1 : 0}:${d.kind ?? "-"}:${d.presetId ?? "-"}`;

export function decodeDraft(parts: string[]): CreateDraft | null {
  const [type, loot, kind, preset] = parts;
  if (type !== "-" && type !== "pvp" && type !== "pve") return null;
  if (loot !== "-" && loot !== "0" && loot !== "1") return null;
  if (kind !== "-" && !(kind && /^[a-z-]{1,30}$/.test(kind))) return null;
  if (preset !== "-" && !(preset && UUID.test(preset))) return null;
  return {
    type: type === "-" ? null : type,
    loot: loot === "-" ? null : loot === "1",
    kind: kind === "-" ? null : kind!,
    presetId: preset === "-" ? null : preset!,
  };
}

// Discord shows the chosen option's label instead of the placeholder, so each label names its field.
export async function createPanel(
  deps: Deps,
  guildId: string,
  draft: CreateDraft,
  mode: "new" | "update",
): Promise<InteractionResponse> {
  const presets = await listPresets(deps.sql, guildId);
  const suffix = encode(draft);
  const kindOptions = draft.type
    ? KINDS.filter((k) => k.type === draft.type).map((k) => ({
        label: `Category: ${k.label}`, value: k.id, default: k.id === draft.kind,
      }))
    : [{ label: "Category: pick the type first", value: "-" }];
  const rows: unknown[] = [
    {
      type: 1,
      components: [{
        type: 3, custom_id: `cp:type:${suffix}`, placeholder: "Type of content",
        options: [
          { label: "Type: PvP", value: "pvp", default: draft.type === "pvp" },
          { label: "Type: PvE", value: "pve", default: draft.type === "pve" },
        ],
      }],
    },
    {
      type: 1,
      components: [{
        type: 3, custom_id: `cp:kind:${suffix}`,
        placeholder: draft.type ? "Category (optional, default Other)" : "Category (pick the type first)",
        disabled: draft.type === null,
        options: kindOptions,
      }],
    },
    {
      type: 1,
      components: [{
        type: 3, custom_id: `cp:loot:${suffix}`, placeholder: "Loot vote (optional, default Off)",
        options: [
          { label: "Loot vote: Off", value: "0", default: draft.loot === false },
          { label: "Loot vote: On (split or regear)", value: "1", default: draft.loot === true },
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
          label: Array.from(`Preset: ${p.name}`).slice(0, 100).join(""), value: p.id, default: p.id === draft.presetId,
        })),
      }],
    });
  }
  rows.push({
    type: 1,
    components: [
      { type: 2, style: 3, label: "Continue", custom_id: `cpgo:${suffix}`, disabled: draft.type === null },
      { type: 2, style: 2, label: "Cancel", custom_id: "cpx" },
    ],
  });
  const data = {
    content: "**Create content**\nPick the type and options, then press Continue to enter the title, time, tier and slots.",
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
  const draft = decodeDraft(parts.slice(2));
  const values = Array.isArray(raw?.values) ? (raw!.values as unknown[]) : null;
  if (parts[0] !== "cp" || !draft || !values || !i.guild_id || values.length > 1) return reply(INVALID);
  if (!(await inContentPost(deps, i))) return reply(NOT_FORUM);
  const value = values[0];

  if (field === "type") {
    if (value !== "pvp" && value !== "pve") return reply(INVALID);
    draft.type = value;
    // A kind of the other type no longer fits; Other fits both.
    if (draft.kind && !kindDef(value, draft.kind)) draft.kind = null;
  } else if (field === "kind") {
    if (!draft.type) return reply(NEED_TYPE);
    const kind = typeof value === "string" ? resolveKind(draft.type, value) : null;
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
  return await createPanel(deps, i.guild_id, draft, "update");
}

export type ReadyDraft = { type: ContentType; loot: boolean; kind: string; presetId: string | null };
type Checked = { ok: true; draft: ReadyDraft } | { ok: false; response: InteractionResponse };

// Shared checks for the buttons after Continue: the draft in the id, the post, the kind and a free post.
export async function checked(deps: Deps, i: Interaction, prefix: string): Promise<Checked> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const parts = typeof raw === "string" ? raw.split(":") : [];
  const draft = parts[0] === prefix ? decodeDraft(parts.slice(1)) : null;
  if (!draft || !i.guild_id) return { ok: false, response: reply(INVALID) };
  if (!draft.type) return { ok: false, response: reply(NEED_TYPE) };
  if (!(await inContentPost(deps, i))) return { ok: false, response: reply(NOT_FORUM) };
  const kind = resolveKind(draft.type, draft.kind);
  if (!kind.ok) return { ok: false, response: reply(kind.error) };
  if (i.channel?.id) {
    const taken = await postTakenReply(deps, i.guild_id, i.channel.id);
    if (taken) return { ok: false, response: taken };
  }
  return { ok: true, draft: { type: draft.type, loot: draft.loot ?? false, kind: kind.value, presetId: draft.presetId } };
}

// Continue: with a preset, open the form with its slots. Otherwise start the guided steps (how many players).
export async function handleCreateContinue(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const c = await checked(deps, i, "cpgo");
  if (!c.ok) return c.response;
  if (c.draft.presetId) {
    const preset = await getPresetById(deps.sql, i.guild_id!, c.draft.presetId);
    if (!preset) return reply("That preset no longer exists. Run `/content create` again.");
    return createForm(c.draft, formatSlotLines(preset.slots));
  }
  return await startGuided(deps, i, c.draft);
}

// Cancel in the create panel: close it and drop any unfinished guided draft of this member in this post.
export async function handleCreateCancel(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const userId = i.member?.user?.id;
  if (i.guild_id && userId && i.channel?.id) {
    const d = await findDraft(deps.sql, { guildId: i.guild_id, threadId: i.channel.id, userId }, deps.now());
    if (d) await deleteDraft(deps.sql, d.id);
  }
  return { type: UPDATE_MESSAGE, data: { content: "Creation cancelled.", embeds: [], components: [] } };
}

export { DEFAULT_KIND };
