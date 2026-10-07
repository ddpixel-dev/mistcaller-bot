import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { MODAL, reply } from "../discord/response.ts";
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

function lootOption(i: Interaction): boolean {
  const data = i.data as { options?: { name?: string; options?: { name?: string; value?: unknown }[] }[] } | undefined;
  const create = data?.options?.find((o) => o.name === "create");
  return create?.options?.find((o) => o.name === "loot")?.value === true;
}

const input = (
  custom_id: string,
  label: string,
  max_length: number,
  extra: Record<string, unknown> = {},
) => ({
  type: 1,
  components: [{ type: 4, custom_id, label, style: 1, max_length, required: true, ...extra }],
});

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
  if ((await forumType(deps, i)) === null) return reply(NOT_FORUM);
  if (i.guild_id && i.channel?.id) {
    const taken = await postTakenReply(deps, i.guild_id, i.channel.id);
    if (taken) return taken;
  }
  return {
    type: MODAL,
    data: {
      custom_id: `create:${lootOption(i) ? 1 : 0}`,
      title: "Create content",
      components: [
        input("title", "Title", 100),
        input("start", "Start time (UTC, YYYY-MM-DD HH:mm)", 20, { placeholder: "2026-10-07 18:00" }),
        input("tier", "Tier", 30, { placeholder: "T5.3 or T5.3-T7.0" }),
        input("slots", "Slots (one per line: Role - Weapon)", 1500, { style: 2, placeholder: "Tank - Axe" }),
        input("notes", "Notes (optional)", 500, { required: false }),
      ],
    },
  };
}

function modalValues(i: Interaction): Record<string, string> {
  const rows = ((i.data as { components?: unknown[] } | undefined)?.components ?? []) as {
    components?: { custom_id?: string; value?: string }[];
  }[];
  const out: Record<string, string> = {};
  for (const row of rows) {
    const c = row.components?.[0];
    if (c && typeof c.custom_id === "string") out[c.custom_id] = typeof c.value === "string" ? c.value : "";
  }
  return out;
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
  const hasLoot = customId === "create:1";

  let id: string;
  try {
    id = await createContent(deps.sql, {
      guildId: i.guild_id,
      threadId,
      type,
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
