import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { MODAL, reply } from "../discord/response.ts";
import { modalValues, subOption, textInput } from "../discord/modal.ts";
import { resolveKind } from "../domain/kinds.ts";
import { BUILD_REFERENCE_HELP, packRef, parseBuildReference, unpackRef } from "../domain/buildref.ts";
import {
  PostTakenError, createContent, deleteContent, findContentInThread, getRosterView, setMessageId,
} from "../db/content.ts";
import { parseGearTier, parseNotes, parseSlots, parseTitle, parseUtcStart } from "../domain/parse.ts";
import { renderRosterMessage } from "../render/roster.ts";
import { DiscordApiError } from "../discord/rest.ts";
import type { ContentType } from "../domain/types.ts";
import { DEFAULT_DRAFT, createPanel } from "./create-panel.ts";
import { formProblems } from "./retry.ts";
import { refreshDashboardSoon } from "../jobs/dashboards.ts";
import { defaultStart } from "../domain/time.ts";

export const NOT_HERE = "Use this command in a server channel, thread or forum post that the bot can write in.";
const FAILED = "Could not create the content right now. Nothing was saved, please try again.";

// FR-002 (changed 2026-10-08, ADR 0020): content may be created in any text channel, announcement channel, thread or
// forum post of a server. The type (PvP or PvE) is chosen in the create panel, so no forum setup is needed.
const CONTENT_PLACES = new Set([0, 5, 10, 11, 12]);

// The build reference option of a command (FR-031, ADR 0025): a Discord link to a channel, thread, post or message of
// this server. `undefined` means the option was not given.
export function readBuildReference(i: Interaction, sub: string): { ok: true; id: string | undefined } | { ok: false; error: string } {
  const value = subOption(i, sub, "build-reference");
  if (value === undefined) return { ok: true, id: undefined };
  const parsed = typeof value === "string" ? parseBuildReference(value, i.guild_id ?? "") : null;
  if (!parsed) return { ok: false, error: `That is not a link. ${BUILD_REFERENCE_HELP}` };
  return parsed.ok ? { ok: true, id: parsed.value } : parsed;
}

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
  const build = readBuildReference(i, "create");
  if (!build.ok) return reply(build.error);
  return await createPanel(deps, i.guild_id, { ...DEFAULT_DRAFT, buildRef: build.id ?? null }, "new");
}

export function createForm(draft: { type: ContentType; loot: boolean; kind: string; buildRef?: string | null }, presetLines: string | null, now: Date): InteractionResponse {
  return {
    type: MODAL,
    data: {
      custom_id: `create:${draft.type}:${draft.loot ? 1 : 0}:${draft.kind}${draft.buildRef ? `:${packRef(draft.buildRef)}` : ""}`,
      title: "Create content",
      components: [
        textInput("title", "Title", 100),
        textInput("start", "Start time (UTC, YYYY-MM-DD HH:mm)", 20, { placeholder: "2026-10-07 18:00", value: defaultStart(now) }),
        textInput("tier", "Gear Tier", 80, { placeholder: "Weapon T7.1 - Gear T4.3" }),
        textInput("slots", "Slots (one per line: Role - Weapon)", 1500, {
          style: 2, placeholder: "Tank - Axe  (the weapon is optional: Tank)", ...(presetLines ? { value: presetLines } : {}),
        }),
        textInput("notes", "Notes (optional)", 500, { required: false }),
      ],
    },
  };
}

export async function handleCreateModal(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const customId = (i.data as { custom_id?: string } | undefined)?.custom_id ?? "";
  const [, typeId, lootFlag, kindId, buildId] = customId.split(":");
  const creator = i.member?.user?.id;
  const threadId = i.channel?.id;
  if (!i.guild_id || !creator || !threadId) return reply(NOT_HERE);
  const problem = placeProblem(i);
  if (problem) return reply(problem);
  if (typeId !== "pvp" && typeId !== "pve" && typeId !== "pvx") return reply("That form is out of date. Run `/content create` again.");
  const buildRef = buildId === undefined ? null : unpackRef(buildId);
  if (buildId !== undefined && buildRef === null) return reply("That form is out of date. Run `/content create` again.");
  const type: ContentType = typeId;

  const v = modalValues(i);
  const title = parseTitle(v.title ?? "");
  const start = parseUtcStart(v.start ?? "", deps.now());
  const tier = parseGearTier(v.tier ?? "");
  const slots = parseSlots(v.slots ?? "");
  const notes = parseNotes(v.notes ?? "");
  // Every mistake at once, with a button that reopens the form filled in (ADR 0025).
  if (!title.ok || !start.ok || !tier.ok || !slots.ok || !notes.ok) {
    return await formProblems(deps, i, customId, [title, start, tier, slots, notes].flatMap((r) => (r.ok ? [] : [r.error])));
  }

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
      buildRef,
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
  await refreshDashboardSoon(deps, i.guild_id, "schedule"); // FR-043
  return reply("Created");
}
