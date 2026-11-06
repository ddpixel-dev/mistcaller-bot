import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, MODAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { modalValues, textInput } from "../discord/modal.ts";
import { deleteDraft, getDraft, saveCard, startCard, type StoredDraft } from "../db/draft.ts";
import { getEventForum, listEventForums } from "../db/eventForum.ts";
import { getCtaForum } from "../db/cta.ts";
import { getPresetById, listPresets } from "../db/preset.ts";
import { pickEventForum, typesFor, validateBlank, validateCard } from "../domain/card.ts";
import { DEFAULT_KIND, TYPE_LABEL, resolveKind } from "../domain/kinds.ts";
import { parseBuildReference } from "../domain/buildref.ts";
import { parseSlots } from "../domain/parse.ts";
import { formatSlotLines } from "../domain/slots.ts";
import { defaultStart } from "../domain/time.ts";
import type { ContentType } from "../domain/types.ts";
import { renderCard, v2Text } from "../render/card.ts";
import { renderGuidedStep } from "../render/guided.ts";
import { NOT_HERE, publish } from "./create.ts";
import { getAdminRoleIds } from "../db/settings.ts";
import { getCtaRoleIds } from "../db/cta.ts";
import { canCreateCta } from "../domain/permissions.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPIRED = "This card expired or is not yours. Press **Normal content** or **Special content** in the content-management channel again.";

type Opened = { targetForumId: string | null; forumType: "pvp" | "pve" | null; title: string | null; buildRef?: string | null; cta?: boolean };

// Open the creation card (FR-054): from the Normal content or Special content (CTA) button of the content-management channel.
export async function openCard(deps: Deps, i: Interaction, o: Opened): Promise<InteractionResponse> {
  const userId = i.member?.user?.id;
  const threadId = i.channel?.id;
  if (!i.guild_id || !userId || !threadId) return reply(NOT_HERE);
  const only = typesFor(o.forumType);
  const id = await startCard(deps.sql, {
    guildId: i.guild_id, userId, threadId, type: only.length === 1 ? only[0]! : null, title: o.title, startText: defaultStart(deps.now()),
    targetForumId: o.targetForumId, cta: o.cta ?? false,
  });
  if (o.buildRef) await saveCard(deps.sql, id, { buildRef: o.buildRef });
  const d = await getDraft(deps.sql, id, deps.now());
  if (!d) return reply(EXPIRED);
  const data = await card(deps, d);
  return { type: CHANNEL_MESSAGE, data: { ...data, flags: data.flags | EPHEMERAL } };
}

// lc:create: the Create event button of an old launcher post. Launcher posts are gone since ADR 0036: content is created
// with the buttons in the content-management channel.
export async function handleLauncher(_deps: Deps, _i: Interaction): Promise<InteractionResponse> {
  return reply("Creating content has moved: use the **Normal content** or **Special content** buttons in the content-management channel.");
}

async function card(deps: Deps, d: StoredDraft, extra: { problems?: string[]; note?: string } = {}) {
  const presets = (await listPresets(deps.sql, d.guildId)).map((p) => ({ id: p.id, name: p.name, count: p.slots.length }));
  const forum = d.targetForumId ? await getEventForum(deps.sql, d.guildId, d.targetForumId) : null;
  return renderCard(d, { presets, forumType: forum?.type ?? null, now: deps.now(), ...extra });
}

export const showCard = async (deps: Deps, d: StoredDraft, extra: { problems?: string[]; note?: string } = {}): Promise<InteractionResponse> =>
  ({ type: UPDATE_MESSAGE, data: await card(deps, d, extra) });

// Only the member who opened the card, in the place where it was opened, can use it.
export async function ownedDraft(deps: Deps, i: Interaction, id: string | undefined): Promise<StoredDraft | null> {
  if (!id || !UUID.test(id)) return null;
  const d = await getDraft(deps.sql, id, deps.now());
  if (!d || d.guildId !== i.guild_id || d.userId !== i.member?.user?.id || d.threadId !== i.channel?.id) return null;
  return d;
}

const reload = async (deps: Deps, d: StoredDraft) => (await getDraft(deps.sql, d.id, deps.now())) ?? d;

// cc:<action>:<draft>: the card's menus and buttons.
export async function handleCardComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = i.data as { custom_id?: unknown; values?: unknown } | undefined;
  const [prefix, action, id, extra] = typeof data?.custom_id === "string" ? data.custom_id.split(":") : [];
  if (prefix !== "cc" || extra !== undefined) return reply(EXPIRED);
  const d = await ownedDraft(deps, i, id);
  if (!d) return reply(EXPIRED);
  const value = Array.isArray(data?.values) && data!.values.length === 1 && typeof data!.values[0] === "string" ? data!.values[0] as string : null;

  switch (action) {
    case "type": {
      const forum = d.targetForumId ? await getEventForum(deps.sql, d.guildId, d.targetForumId) : null;
      if (!value || !(typesFor(forum?.type ?? null) as string[]).includes(value)) return reply(EXPIRED);
      const type = value as ContentType;
      // A category that does not fit the new type goes back to Other.
      const kind = resolveKind(type, d.kind).ok ? d.kind : DEFAULT_KIND;
      await saveCard(deps.sql, d.id, { type, kind });
      return await showCard(deps, await reload(deps, d));
    }
    case "kind": {
      if (!d.type || !value || !resolveKind(d.type, value).ok) return reply(EXPIRED);
      await saveCard(deps.sql, d.id, { kind: value });
      return await showCard(deps, await reload(deps, d));
    }
    case "loot": {
      if (value !== "0" && value !== "1") return reply(EXPIRED);
      await saveCard(deps.sql, d.id, { loot: value === "1" });
      return await showCard(deps, await reload(deps, d));
    }
    case "sel": {
      if (value !== "0" && value !== "1") return reply(EXPIRED);
      await saveCard(deps.sql, d.id, { selection: value === "1" });
      return await showCard(deps, await reload(deps, d));
    }
    case "preset": {
      const preset = value ? await getPresetById(deps.sql, d.guildId, value) : null;
      if (!preset) return reply("That preset no longer exists.");
      await saveCard(deps.sql, d.id, { slots: preset.slots.slice(0, 20), slotsText: null });
      return await showCard(deps, await reload(deps, d), { note: `📋 Slots from the preset **${preset.name.replace(/[*_`~|\\]/g, "")}**.` });
    }
    case "details": return detailsForm(d);
    case "blank": {
      if (!d.cta && !d.type) return await showCard(deps, d, { problems: ["Pick the type of content (PvP or PvE) first, then press Blank."] });
      return blankForm(d);
    }
    case "build": {
      return {
        type: MODAL,
        data: {
          custom_id: `ccb:${d.id}`,
          title: "Build link",
          components: [textInput("link", "Link to a channel, post or message", 200, {
            required: false, placeholder: "Leave empty for no build link",
            ...(d.buildRef ? { value: `https://discord.com/channels/${d.guildId}/${d.buildRef}` } : {}),
          })],
        },
      };
    }
    case "guided": return { type: UPDATE_MESSAGE, data: renderGuidedStep(d) };
    case "create": return await create(deps, i, d);
    case "cancel": {
      await deleteDraft(deps.sql, d.id);
      return { type: UPDATE_MESSAGE, data: v2Text("Creation cancelled.") };
    }
    default: return reply(EXPIRED);
  }
}

// Details: the card's text in one form, filled with what is set; the start begins at now plus an hour (ADR 0034).
function detailsForm(d: StoredDraft): InteractionResponse {
  const slots = d.slotsText ?? formatSlotLines(d.slots);
  return {
    type: MODAL,
    data: {
      custom_id: `ccd:${d.id}`,
      title: "Event details",
      components: [
        textInput("title", "Title", 100, { required: false, ...(d.title ? { value: d.title } : {}) }),
        textInput("start", "Start time (UTC, YYYY-MM-DD HH:mm)", 20, { required: false, placeholder: "2026-10-07 18:00", ...(d.startText ? { value: d.startText } : {}) }),
        textInput("tier", "Gear Tier", 80, { required: false, placeholder: "Weapon T7.1 - Gear T4.3", ...(d.gearTier ? { value: d.gearTier } : {}) }),
        textInput("slots", "Slots (one per line: Role - Weapon)", 1500, {
          style: 2, required: false, placeholder: "Tank - Axe  (the weapon is optional: Tank)", ...(slots ? { value: slots } : {}),
        }),
        textInput("notes", "Notes (optional)", 500, { style: 2, required: false, ...(d.notes ? { value: d.notes } : {}) }),
      ],
    },
  };
}

const clean = (s: string | undefined) => {
  const t = (s ?? "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim();
  return t === "" ? null : t;
};

// ccd:<draft>: the Details form. Everything typed is kept; slot lines that do not parse stay as typed until fixed.
export async function handleCardDetails(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const [prefix, id, extra] = typeof raw === "string" ? raw.split(":") : [];
  if (prefix !== "ccd" || extra !== undefined) return reply(EXPIRED);
  const d = await ownedDraft(deps, i, id);
  if (!d) return reply(EXPIRED);
  const v = modalValues(i);
  const typed = (v.slots ?? "").trim();
  const parsed = typed ? parseSlots(typed) : null;
  await saveCard(deps.sql, d.id, {
    title: clean(v.title), startText: clean(v.start), gearTier: clean(v.tier), notes: clean(v.notes),
    ...(parsed === null ? { slots: [], slotsText: null } : parsed.ok ? { slots: parsed.value, slotsText: null } : { slotsText: typed }),
  });
  return await showCard(deps, await reload(deps, d), parsed && !parsed.ok ? { problems: [`Slots: ${parsed.error}`] } : {});
}

// ccb:<draft>: the Build link form. Empty removes it (FR-031).
export async function handleCardBuild(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const [prefix, id, extra] = typeof raw === "string" ? raw.split(":") : [];
  if (prefix !== "ccb" || extra !== undefined) return reply(EXPIRED);
  const d = await ownedDraft(deps, i, id);
  if (!d || !i.guild_id) return reply(EXPIRED);
  const text = (modalValues(i).link ?? "").trim();
  if (!text) {
    await saveCard(deps.sql, d.id, { buildRef: null });
    return await showCard(deps, await reload(deps, d));
  }
  const parsed = parseBuildReference(text, i.guild_id);
  if (!parsed.ok) return await showCard(deps, d, { problems: [parsed.error] });
  await saveCard(deps.sql, d.id, { buildRef: parsed.value });
  return await showCard(deps, await reload(deps, d));
}

type Destination = { ok: true; forumId: string } | { ok: false; problem: string };

// Where the content is posted (ADR 0036): a CTA in the CTA forum, normal content in the event forum of its type. A card
// opened from an old launcher post still goes to that launcher's forum.
async function destinationOf(deps: Deps, d: StoredDraft, type: ContentType): Promise<Destination> {
  if (d.targetForumId) return { ok: true, forumId: d.targetForumId };
  if (d.cta) {
    const forum = await getCtaForum(deps.sql, d.guildId);
    return forum ? { ok: true, forumId: forum } : { ok: false, problem: "No CTA forum is set. Ask an admin to run `/content setup` with `cta-channel`." };
  }
  const forum = pickEventForum(await listEventForums(deps.sql, d.guildId), type);
  return forum ? { ok: true, forumId: forum.forumId } : { ok: false, problem: `No event forum takes ${TYPE_LABEL[type]} content. Ask an admin to run \`/content setup\` with \`event-forum\`.` };
}

// A CTA is checked again at Create: the roles may have changed since the card was opened.
async function ctaAllowed(deps: Deps, i: Interaction, d: StoredDraft): Promise<boolean> {
  if (!d.cta) return true;
  const actor = { userId: d.userId, roles: i.member?.roles ?? [], permissions: i.member?.permissions };
  return canCreateCta(actor, await getAdminRoleIds(deps.sql, d.guildId), await getCtaRoleIds(deps.sql, d.guildId));
}

const NOT_CTA = "Special content (CTA) is for admins and members with a CTA role.";

// Create: every problem is listed on the card; otherwise the roster is posted in a new forum post (FR-059).
async function create(deps: Deps, i: Interaction, d: StoredDraft): Promise<InteractionResponse> {
  const checked = validateCard(d, deps.now());
  if (!checked.ok) return await showCard(deps, d, { problems: checked.problems });
  if (!(await ctaAllowed(deps, i, d))) return reply(NOT_CTA);
  const c = checked.value;
  const where = await destinationOf(deps, d, c.type);
  if (!where.ok) return await showCard(deps, d, { problems: [where.problem] });
  const done = await publish(deps, {
    guildId: d.guildId, creator: d.userId, type: c.type, kind: c.kind, title: c.title, notes: c.notes, startsAt: c.startsAt, tier: c.tier,
    slots: c.slots, hasLoot: d.loot, selection: d.selection, cta: d.cta, buildRef: d.buildRef, place: { forumId: where.forumId },
  });
  if (!done.ok) return done.response;
  await deleteDraft(deps.sql, d.id);
  const link = `https://discord.com/channels/${d.guildId}/${done.threadId}/${done.messageId}`;
  return { type: UPDATE_MESSAGE, data: v2Text(`✅ Created: ${link}`) };
}

// Blank (FR-060): the card's Blank button opens the final form with only title, start, gear tier and description; the
// content has no roster. It reads and keeps the same fields as Details, so nothing typed is lost.
function blankForm(d: StoredDraft): InteractionResponse {
  return {
    type: MODAL,
    data: {
      custom_id: `ccl:${d.id}`,
      title: d.cta ? "Blank CTA" : "Blank content",
      components: [
        textInput("title", "Title", 100, { required: true, ...(d.title ? { value: d.title } : {}) }),
        textInput("start", "Start time (UTC, YYYY-MM-DD HH:mm)", 20, { required: true, placeholder: "2026-10-07 18:00", ...(d.startText ? { value: d.startText } : {}) }),
        textInput("tier", "Gear Tier", 80, { required: true, placeholder: "Weapon T7.1 - Gear T4.3", ...(d.gearTier ? { value: d.gearTier } : {}) }),
        textInput("notes", "Description (optional)", 500, { style: 2, required: false, ...(d.notes ? { value: d.notes } : {}) }),
      ],
    },
  };
}

// ccl:<draft>: the Blank form. Problems are listed on the card; otherwise the content is posted.
export async function handleBlankForm(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const [prefix, id, extra] = typeof raw === "string" ? raw.split(":") : [];
  if (prefix !== "ccl" || extra !== undefined) return reply(EXPIRED);
  const d = await ownedDraft(deps, i, id);
  if (!d) return reply(EXPIRED);
  const v = modalValues(i);
  await saveCard(deps.sql, d.id, { title: clean(v.title), startText: clean(v.start), gearTier: clean(v.tier), notes: clean(v.notes) });
  const fresh = await reload(deps, d);
  const checked = validateBlank(fresh, fresh.cta, deps.now());
  if (!checked.ok) return await showCard(deps, fresh, { problems: checked.problems });
  if (!(await ctaAllowed(deps, i, fresh))) return reply(NOT_CTA);
  const c = checked.value;
  const where = await destinationOf(deps, fresh, c.type);
  if (!where.ok) return await showCard(deps, fresh, { problems: [where.problem] });
  const done = await publish(deps, {
    guildId: fresh.guildId, creator: fresh.userId, type: c.type, kind: DEFAULT_KIND, title: c.title, notes: c.notes, startsAt: c.startsAt, tier: c.tier,
    slots: [], hasLoot: false, cta: fresh.cta, blank: true, buildRef: null, place: { forumId: where.forumId },
  });
  if (!done.ok) return done.response;
  await deleteDraft(deps.sql, d.id);
  return { type: UPDATE_MESSAGE, data: v2Text(`✅ Created: https://discord.com/channels/${d.guildId}/${done.threadId}/${done.messageId}`) };
}

// A form or panel of an earlier version (the first form, the create panel): it no longer exists.
export async function handleOldCreate(): Promise<InteractionResponse> {
  return reply("This is from an earlier version. Press **Normal content** or **Special content** in the content-management channel.");
}

