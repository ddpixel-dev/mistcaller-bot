import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { MODAL, reply } from "../discord/response.ts";
import { modalValues, subOption, textInput } from "../discord/modal.ts";
import { resolveKind } from "../domain/kinds.ts";
import { getPreset } from "../db/preset.ts";
import { formatSlotLines } from "../domain/slots.ts";
import { getGuildSettings } from "../db/settings.ts";
import {
  PostTakenError, createContent, deleteContent, findContentInThread, getRosterView, setMessageId,
} from "../db/content.ts";
import { forumContentType } from "../domain/forum.ts";
import { parseNotes, parseSlots, parseTier, parseTitle, parseUtcStart } from "../domain/parse.ts";
import { renderRosterMessage } from "../render/roster.ts";
import type { ContentType } from "../domain/types.ts";

const NOT_FORUM = "Use this command inside a post in the PvP or PvE content forum.";
const FAILED = "Could not create the content right now. Nothing was saved, please try again.";

async function forumType(deps: Deps, i: Interaction): Promise<ContentType | null> {
  if (!i.guild_id) return null;
  const settings = await getGuildSettings(deps.sql, i.guild_id);
  if (!settings) return null;
  if (i.channel?.type !== 11) return null;
  return forumContentType(settings, i.channel.parent_id ?? null);
}

async function postTakenReply(deps: Deps, guildId: string, threadId: string): Promise<InteractionResponse | null> {
  const existing = await findContentInThread(deps.sql, guildId, threadId);
  if (!existing) return null;
  const link = existing.messageId ? ` https://discord.com/channels/${guildId}/${threadId}/${existing.messageId}` : "";
  return reply(takenMessage(existing.status, link));
}

function takenMessage(status: string, link: string): string {
  return status === "done"
    ? `This post's content has finished, so it cannot take a new one.${link}`
    : `This post already has content.${link} Cancel it first to create a new one.`;
}

export async function handleCreateCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const type = await forumType(deps, i);
  if (type === null) return reply(NOT_FORUM);
  const kindOpt = subOption(i, "create", "kind");
  const kind = resolveKind(type, typeof kindOpt === "string" ? kindOpt : null);
  if (!kind.ok) return reply(kind.error);
  const presetOpt = subOption(i, "create", "preset");
  let presetLines: string | null = null;
  if (typeof presetOpt === "string" && presetOpt.trim() !== "" && i.guild_id) {
    const preset = await getPreset(deps.sql, i.guild_id, presetOpt.trim());
    if (!preset) return reply("There is no preset with that name. Use `/content preset list` to see them.");
    presetLines = formatSlotLines(preset.slots);
  }
  if (i.guild_id && i.channel?.id) {
    const taken = await postTakenReply(deps, i.guild_id, i.channel.id);
    if (taken) return taken;
  }
  return {
    type: MODAL,
    data: {
      custom_id: `create:${subOption(i, "create", "loot-vote") === true ? 1 : 0}:${kind.value}`,
      title: "Create content",
      components: [
        textInput("title", "Title", 100),
        textInput("start", "Start time (UTC, YYYY-MM-DD HH:mm)", 20, { placeholder: "2026-10-07 18:00" }),
        textInput("tier", "Tier", 30, { placeholder: "T5.3 or T5.3-T7.0" }),
        textInput("slots", "Slots (one per line: Role - Weapon)", 1500, {
          style: 2, placeholder: "Tank - Axe", ...(presetLines ? { value: presetLines } : {}),
        }),
        textInput("notes", "Notes (optional)", 500, { required: false }),
      ],
    },
  };
}

export async function handleCreateModal(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const type = await forumType(deps, i);
  const creator = i.member?.user?.id;
  const threadId = i.channel?.id;
  if (type === null || !i.guild_id || !creator || !threadId) return reply(NOT_FORUM);

  const v = modalValues(i);
  const title = parseTitle(v.title ?? "");
  if (!title.ok) return reply(title.error);
  const start = parseUtcStart(v.start ?? "", deps.now());
  if (!start.ok) return reply(start.error);
  const tier = parseTier(v.tier ?? "");
  if (!tier.ok) return reply(tier.error);
  const slots = parseSlots(v.slots ?? "");
  if (!slots.ok) return reply(slots.error);
  const notes = parseNotes(v.notes ?? "");
  if (!notes.ok) return reply(notes.error);

  const customId = (i.data as { custom_id?: string }).custom_id ?? "";
  const [, lootFlag, kindId] = customId.split(":");
  const hasLoot = lootFlag === "1";
  const kind = resolveKind(type, kindId ?? null);
  if (!kind.ok) return reply(kind.error);

  let id: string;
  try {
    id = await createContent(deps.sql, {
      guildId: i.guild_id,
      threadId,
      type,
      kind: kind.value,
      title: title.value,
      notes: notes.value,
      startsAt: start.value,
      tier: tier.value,
      hasLoot,
      createdBy: creator,
      slots: slots.value,
    });
  } catch (err) {
    if (err instanceof PostTakenError) return (await postTakenReply(deps, i.guild_id, threadId)) ?? reply(FAILED);
    throw err;
  }
  const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");
  let postedId: string | null = null;
  try {
    const view = await getRosterView(deps.sql, id, deps.now());
    if (!view) throw new Error("content row missing");
    const posted = await deps.rest.createMessage(threadId, renderRosterMessage(view));
    postedId = posted.id;
    await setMessageId(deps.sql, id, posted.id);
  } catch (err) {
    await deleteContent(deps.sql, id).catch((e) => {
      console.error(JSON.stringify({ evt: "cleanup_failed", error: errName(e) }));
    });
    if (postedId !== null) {
      await deps.rest.deleteMessage(threadId, postedId).catch((e) => {
        console.error(JSON.stringify({ evt: "orphan_delete_failed", name: errName(e) }));
    });
    }
    console.error(JSON.stringify({ evt: "create_failed", name: errName(err) }));
    return reply(FAILED);
  }
  return reply("Created");
}
