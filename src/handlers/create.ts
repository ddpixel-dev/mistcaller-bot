import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { MODAL, reply } from "../discord/response.ts";
import { modalValues, textInput } from "../discord/modal.ts";
import { resolveKind } from "../domain/kinds.ts";
import {
  PostTakenError, createContent, deleteContent, findContentInThread, getRosterView, setMessageId,
} from "../db/content.ts";
import { parseGearTier, parseNotes, parseSlots, parseTitle, parseUtcStart } from "../domain/parse.ts";
import { renderRosterMessage } from "../render/roster.ts";
import { DiscordApiError } from "../discord/rest.ts";
import type { ContentType } from "../domain/types.ts";
import { DEFAULT_DRAFT, createPanel } from "./create-panel.ts";

export const NOT_HERE = "Use this command in a server channel, thread or forum post that the bot can write in.";
const FAILED = "Could not create the content right now. Nothing was saved, please try again.";

// FR-002 (changed 2026-10-08, ADR 0020): content may be created in any text channel, announcement channel, thread or
// forum post of a server. The type (PvP or PvE) is chosen in the create panel, so no forum setup is needed.
const CONTENT_PLACES = new Set([0, 5, 10, 11, 12]);
export function inContentPlace(i: Interaction): boolean {
  return Boolean(i.guild_id && i.channel && CONTENT_PLACES.has(i.channel.type));
}

const NOT_INSTALLED = "The bot is not added to this server yet, only to an account. Someone with Manage Server must add it to the server with the invite link (choose the server, not \"Add to my apps\"), then try again.";
const NO_ACCESS = "The bot cannot post here. Give the bot's role View Channel and Send Messages in this channel (and Send Messages in Threads for threads and forum posts), then try again.";
const VIEW_CHANNEL = 1n << 10n, SEND_MESSAGES = 1n << 11n, SEND_IN_THREADS = 1n << 38n, ADMINISTRATOR = 8n;

// What is wrong with creating content here, as a message for the user, or null when it looks fine. The bot's own
// permissions come with the interaction, so this is checked before anything is saved or any post is tried.
export function placeProblem(i: Interaction): string | null {
  if (!inContentPlace(i)) return NOT_HERE;
  if (i.authorizing_integration_owners && !("0" in i.authorizing_integration_owners)) return NOT_INSTALLED;
  const raw = i.app_permissions;
  if (!raw || !/^\d+$/.test(raw)) return null; // not told: try, and the generic failure message covers the rest
  const have = BigInt(raw);
  if (have & ADMINISTRATOR) return null;
  const inThread = [10, 11, 12].includes(i.channel!.type);
  const need = VIEW_CHANNEL | (inThread ? SEND_IN_THREADS : SEND_MESSAGES);
  return (have & need) === need ? null : NO_ACCESS;
}

export async function postTakenReply(deps: Deps, guildId: string, threadId: string): Promise<InteractionResponse | null> {
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

// Step 1 of creation: a private panel to pick the type, kind, loot vote and preset. Step 2 is the form.
export async function handleCreateCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  if (!i.guild_id) return reply(NOT_HERE);
  const problem = placeProblem(i);
  if (problem) return reply(problem);
  if (i.channel?.id) {
    const taken = await postTakenReply(deps, i.guild_id, i.channel.id);
    if (taken) return taken;
  }
  return await createPanel(deps, i.guild_id, DEFAULT_DRAFT, "new");
}

export function createForm(draft: { type: ContentType; loot: boolean; kind: string }, presetLines: string | null): InteractionResponse {
  return {
    type: MODAL,
    data: {
      custom_id: `create:${draft.type}:${draft.loot ? 1 : 0}:${draft.kind}`,
      title: "Create content",
      components: [
        textInput("title", "Title", 100),
        textInput("start", "Start time (UTC, YYYY-MM-DD HH:mm)", 20, { placeholder: "2026-10-07 18:00" }),
        textInput("tier", "Gear Tier", 80, { placeholder: "Weapon T7.1 - Gear T4.3" }),
        textInput("slots", "Slots (one per line: Role - Weapon)", 1500, {
          style: 2, placeholder: "Tank - Axe", ...(presetLines ? { value: presetLines } : {}),
        }),
        textInput("notes", "Notes (optional)", 500, { required: false }),
      ],
    },
  };
}

export async function handleCreateModal(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const customId = (i.data as { custom_id?: string } | undefined)?.custom_id ?? "";
  const [, typeId, lootFlag, kindId] = customId.split(":");
  const creator = i.member?.user?.id;
  const threadId = i.channel?.id;
  if (!i.guild_id || !creator || !threadId) return reply(NOT_HERE);
  const problem = placeProblem(i);
  if (problem) return reply(problem);
  if (typeId !== "pvp" && typeId !== "pve") return reply("That form is out of date. Run `/content create` again.");
  const type: ContentType = typeId;

  const v = modalValues(i);
  const title = parseTitle(v.title ?? "");
  if (!title.ok) return reply(title.error);
  const start = parseUtcStart(v.start ?? "", deps.now());
  if (!start.ok) return reply(start.error);
  const tier = parseGearTier(v.tier ?? "");
  if (!tier.ok) return reply(tier.error);
  const slots = parseSlots(v.slots ?? "");
  if (!slots.ok) return reply(slots.error);
  const notes = parseNotes(v.notes ?? "");
  if (!notes.ok) return reply(notes.error);

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
      now: deps.now(),
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
    console.error(JSON.stringify({
      evt: "create_failed",
      name: errName(err),
      ...(err instanceof DiscordApiError ? { status: err.status, code: err.code, detail: err.detail } : {}),
    }));
    return reply(FAILED);
  }
  return reply("Created");
}
