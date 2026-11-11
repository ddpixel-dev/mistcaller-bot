import { postName } from "../domain/postname.ts";
import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { MODAL, reply } from "../discord/response.ts";
import { modalValues, subOption, textInput } from "../discord/modal.ts";
import { resolveKind } from "../domain/kinds.ts";
import { BUILD_REFERENCE_HELP, packRef, parseBuildReference, unpackRef } from "../domain/buildref.ts";
import {
  PostTakenError, createContent, deleteContent, findContentInThread, getRosterView, setMessageId, setPartyMessageId,
} from "../db/content.ts";
import { parseGearTier, parseNotes, parseSlots, parseTitle, parseUtcStart } from "../domain/parse.ts";
import { IS_COMPONENTS_V2, renderRosterMessage } from "../render/roster.ts";
import { DiscordApiError } from "../discord/rest.ts";
import type { ContentType, SlotDef } from "../domain/types.ts";
import { matchTags } from "../domain/card.ts";
import { openCard } from "./card.ts";
import { announcementBody } from "./ctaannounce.ts";
import { postCtaMessage } from "./ctamsg.ts";
import { pinQuietly } from "./pins.ts";
import { forumOfLauncher } from "../db/eventForum.ts";
import { formProblems } from "./retry.ts";
import { refreshDashboardSoon } from "../jobs/dashboards.ts";
import { defaultStart } from "../domain/time.ts";

export const NOT_HERE = "Use this command in a server channel, thread or forum post that the bot can write in.";
const FAILED = "Could not create the content right now. Nothing was saved, please try again.";
const NO_THREAD = "The bot could not start a thread in the CTA channel. An admin should give the bot's role View Channel, Send Messages, Create Public Threads, Send Messages in Threads and Manage Threads there, then try again.";
const NO_POST = "The bot could not create a post in this forum. An admin should give the bot's role Create Posts, Send Messages in Posts and Manage Threads in the forum, then try again.";

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

// `/content create`: the creation card (FR-054, ADR 0032), here in this channel or post. A launcher post of an event
// forum is not a place for content: its Create event button makes a new post instead.
export async function handleCreateCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  if (!i.guild_id) return reply(NOT_HERE);
  const problem = placeProblem(i);
  if (problem) return reply(problem);
  if (i.channel?.id) {
    if (await forumOfLauncher(deps.sql, i.guild_id, i.channel.id)) return reply("Press **Create event** above: it makes the event's own post in this forum.");
    const taken = await postTakenReply(deps, i.guild_id, i.channel.id);
    if (taken) return taken;
  }
  const build = readBuildReference(i, "create");
  if (!build.ok) return reply(build.error);
  return await openCard(deps, i, { targetForumId: null, forumType: null, title: postTitle(i), buildRef: build.id ?? null });
}

// The title starts as the name of the forum post or thread the form is opened in (owner request 2026-10-24, ADR 0029).
// A channel name such as "pvp-content" is rarely an event title, so an ordinary channel leaves it empty.
export function postTitle(i: Interaction): string | null {
  const name = i.channel && [10, 11, 12].includes(i.channel.type) ? i.channel.name?.trim() : "";
  return name ? Array.from(name).slice(0, 100).join("") : null;
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

  const done = await publish(deps, {
    guildId: i.guild_id, creator, type, kind: kind.value, title: title.value, notes: notes.value, startsAt: start.value,
    tier: tier.value, slots: slots.value, hasLoot, buildRef, place: { threadId },
  });
  return done.ok ? reply("Created") : done.response;
}

export type PublishInput = {
  guildId: string; creator: string; type: ContentType; kind: string; title: string; notes: string | null; startsAt: Date;
  tier: string; slots: SlotDef[]; slots2?: SlotDef[]; hasLoot: boolean; selection?: boolean; cta?: boolean; blank?: boolean; buildRef: string | null;
  // Where the roster goes: an existing channel or post, a new post the bot creates in an event forum (ADR 0032), or a new
  // thread under an announcement in a text channel (the CTA channel, ADR 0036).
  place: { threadId: string } | { forumId: string } | { channelId: string };
};

// A forum post needs a first message; it is a Components V2 message so it can become the roster.
const PLACEHOLDER = { flags: IS_COMPONENTS_V2, components: [{ type: 10, content: "⏳ Creating the roster…" }], allowed_mentions: { parse: [] } };
const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

// Save the content and post its roster. Whatever fails, nothing is left behind: the row, the message and a post the
// bot created are removed again.
export async function publish(deps: Deps, a: PublishInput): Promise<{ ok: true; threadId: string; messageId: string; notes: string[] } | { ok: false; response: InteractionResponse }> {
  const startedAt = Date.now();
  let threadId: string;
  let ownPost = false;
  let announcement: { id: string } | null = null;
  let announcementChannel: string | null = null;
  if ("forumId" in a.place) {
    if (!deps.rest.createForumPost) return { ok: false, response: reply(FAILED) };
    const tags = matchTags((await deps.rest.forumTags?.(a.place.forumId)) ?? [], a.type, a.kind);
    try {
      const post = await deps.rest.createForumPost(a.place.forumId, { name: postName(a.title, a.startsAt), message: PLACEHOLDER, ...(tags.length ? { applied_tags: tags } : {}) });
      threadId = post.id;
      ownPost = true;
    } catch (err) {
      logFailure(err);
      return { ok: false, response: reply(NO_POST) };
    }
  } else if ("channelId" in a.place) {
    // A CTA (ADR 0036): an announcement in the channel, a thread started from it, and the roster in that thread.
    if (!deps.rest.startThread) return { ok: false, response: reply(FAILED) };
    const channelId = a.place.channelId;
    try {
      announcement = await deps.rest.createMessage(channelId, announcementBody(a.title, a.startsAt));
      announcementChannel = channelId;
      // postName keeps within Discord's 100 characters for a thread name.
      threadId = (await deps.rest.startThread(channelId, announcement.id, postName(a.title, a.startsAt))).id;
      ownPost = true;
    } catch (err) {
      logFailure(err);
      if (announcement) await deps.rest.deleteMessage(channelId, announcement.id).catch(() => {});
      return { ok: false, response: reply(NO_THREAD) };
    }
  } else {
    threadId = a.place.threadId;
  }
  const starterIsRoster = "forumId" in a.place; // a forum post's first message becomes the roster
  const dropPost = async () => {
    if (ownPost) await deps.rest.deleteChannel?.(threadId).catch((e) => console.error(JSON.stringify({ evt: "orphan_post_delete_failed", name: errName(e) })));
    if (announcement && announcementChannel) await deps.rest.deleteMessage(announcementChannel, announcement.id).catch(() => {});
  };

  let id: string;
  try {
    id = await createContent(deps.sql, {
      guildId: a.guildId, threadId, type: a.type, kind: a.kind, title: a.title, notes: a.notes, startsAt: a.startsAt, tier: a.tier,
      buildRef: a.buildRef, hasLoot: a.hasLoot, selection: a.selection ?? false, cta: a.cta ?? false, blank: a.blank ?? false, createdBy: a.creator, slots: a.slots, slots2: a.slots2, ownPost, now: deps.now(),
    });
  } catch (err) {
    await dropPost();
    if (err instanceof PostTakenError) return { ok: false, response: (await postTakenReply(deps, a.guildId, threadId)) ?? reply(FAILED) };
    throw err;
  }
  let postedId: string | null = null;
  let party2Id: string | null = null;
  try {
    const view = await getRosterView(deps.sql, id, deps.now());
    if (!view) throw new Error("content row missing");
    if (starterIsRoster) {
      // A forum post's first message has the post's id.
      await deps.rest.editMessage(threadId, threadId, renderRosterMessage(view));
      postedId = threadId;
    } else {
      postedId = (await deps.rest.createMessage(threadId, renderRosterMessage(view))).id;
    }
    await setMessageId(deps.sql, id, postedId);
    // Pinned, so the roster is one tap away from the pin icon however far the talk has scrolled (owner request 2026-11-06).
    await pinQuietly(deps, threadId, postedId).catch((e) => console.error(JSON.stringify({ evt: "pin_failed", name: errName(e), ...(e instanceof DiscordApiError ? { status: e.status, code: e.code } : {}) })));
    // A second party has its own message, right after the first (FR-070).
    if (view.partyCount === 2) {
      party2Id = (await deps.rest.createMessage(threadId, renderRosterMessage(view, 2))).id;
      await setPartyMessageId(deps.sql, { guildId: a.guildId, contentId: id, party: 2, messageId: party2Id });
      await pinQuietly(deps, threadId, party2Id).catch((e) => console.error(JSON.stringify({ evt: "pin_failed", name: errName(e), ...(e instanceof DiscordApiError ? { status: e.status, code: e.code } : {}) })));
    }
  } catch (err) {
    await deleteContent(deps.sql, id).catch((e) => {
      console.error(JSON.stringify({ evt: "cleanup_failed", error: errName(e) }));
    });
    if (ownPost) await dropPost();
    else {
      for (const m of [postedId, party2Id]) {
        if (m !== null) {
          await deps.rest.deleteMessage(threadId, m).catch((e) => {
            console.error(JSON.stringify({ evt: "orphan_delete_failed", name: errName(e) }));
          });
        }
      }
    }
    logFailure(err);
    return { ok: false, response: reply(FAILED) };
  }
  // FR-043 and FR-069 in parallel to stay inside the 3-second reply. The CTA message is forwarded under every CTA
  // after the roster is posted and pinned. It never fails the CTA.
  const [, notes] = await Promise.all([
    refreshDashboardSoon(deps, a.guildId, "schedule"),
    a.cta ? postCtaMessage(deps, { guildId: a.guildId, threadId }) : Promise.resolve([] as string[]),
    announcement && announcementChannel
      ? deps.rest.editMessage(announcementChannel, announcement.id, announcementBody(a.title, a.startsAt, { guildId: a.guildId, threadId, messageId: postedId }))
        .catch((e) => console.error(JSON.stringify({ evt: "announcement_edit_failed", name: errName(e), ...(e instanceof DiscordApiError ? { status: e.status, code: e.code } : {}) })))
      : Promise.resolve(),
  ]);
  console.error(JSON.stringify({ evt: "publish_ms", ms: Date.now() - startedAt }));
  return { ok: true, threadId, messageId: postedId, notes };
}

function logFailure(err: unknown): void {
  console.error(JSON.stringify({
    evt: "create_failed",
    name: errName(err),
    ...(err instanceof DiscordApiError ? { status: err.status, code: err.code, detail: err.detail } : {}),
  }));
}

