import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, MODAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { modalValues, textInput } from "../discord/modal.ts";
import { deleteDraft, getDraft, saveCard, startCard, type StoredDraft } from "../db/draft.ts";
import { getEventForum, listEventForums } from "../db/eventForum.ts";
import { getCtaChannel } from "../db/cta.ts";
import { MAX_PRESETS, deletePreset, getPresetById, listPresets, savePreset, type PresetSettings } from "../db/preset.ts";
import { MAX_PARTY_SLOTS, maxPartiesFor, parseCtaSlots } from "../domain/parties.ts";
import { pickEventForum, typesFor, validateBlank, validateCard } from "../domain/card.ts";
import { DEFAULT_KIND, TYPE_LABEL, resolveKind } from "../domain/kinds.ts";
import { parseBuildReference } from "../domain/buildref.ts";
import { parseSlots } from "../domain/parse.ts";
import { parseBombersCap } from "../domain/bombers.ts";
import { formatSlotLines } from "../domain/slots.ts";
import { defaultStart } from "../domain/time.ts";
import type { ContentType } from "../domain/types.ts";
import { NO_PRESET, renderCard, renderPresetPanel, v2Text } from "../render/card.ts";
import { renderGuidedStep } from "../render/guided.ts";
import { NOT_HERE, publish } from "./create.ts";
import { getAdminRoleIds } from "../db/settings.ts";
import { getCtaRoleIds } from "../db/cta.ts";
import { canCreateCta, canManagePresets } from "../domain/permissions.ts";
import { parsePresetName } from "../domain/presets.ts";
import { escapeText, rosterUrl } from "../render/roster.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPIRED = "This card expired or is not yours. Press **Plan Content** or **Schedule CTA** in the content-management channel again.";

type Opened = { targetForumId: string | null; forumType: ContentType | null; title: string | null; buildRef?: string | null; cta?: boolean };

// Open the creation card (FR-054): from the Plan Content or Schedule CTA button of the content-management channel.
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
  return reply("Creating content has moved: use the **Plan Content** or **Schedule CTA** buttons in the content-management channel.");
}

async function card(deps: Deps, d: StoredDraft, extra: { problems?: string[]; note?: string } = {}) {
  const presets = (await listPresets(deps.sql, d.guildId, d.cta)).map((p) => ({ id: p.id, name: p.name, count: p.slots.length }));
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
  if (prefix !== "cc" || (extra !== undefined && !(action === "delyes" && UUID.test(extra)))) return reply(EXPIRED);
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
      if (value === NO_PRESET) return reply("This server has no presets yet. Save one with `/content preset save`.");
      const found = value ? await getPresetById(deps.sql, d.guildId, value) : null;
      const preset = found && found.cta === d.cta ? found : null; // each card loads only its own kind (FR-073)
      if (!preset) return reply("That preset no longer exists.");
      // A preset keeps `party` per slot (absent = 1); loading sets the parties to the highest one (a CTA only).
      const second = d.cta && maxPartiesFor(d.kind, true) > 1 ? preset.slots.filter((s) => s.party === 2).slice(0, MAX_PARTY_SLOTS) : [];
      const first = preset.slots.filter((s) => s.party !== 2).slice(0, 20);
      await saveCard(deps.sql, d.id, {
        ...presetFields(preset.settings, d.cta), slots: first, slotsText: null,
        parties: second.length > 0 ? 2 : 1, slots2: second.map(({ party: _p, ...s }) => s), slots2Text: null,
      });
      return await showCard(deps, await reload(deps, d), {
        note: `📋 Filled from the preset **${preset.name.replace(/[*_`~|\\]/g, "")}**${preset.settings ? "" : " (slots only: it was saved before presets kept everything)"}.`,
      });
    }
    case "parties": {
      if (!d.cta || maxPartiesFor(d.kind, true) < 2 || (value !== "1" && value !== "2")) return reply(EXPIRED);
      // Back to one party drops party 2, typed text included.
      await saveCard(deps.sql, d.id, value === "1" ? { parties: 1, slots2: [], slots2Text: null } : { parties: 2 });
      return await showCard(deps, await reload(deps, d));
    }
    case "p1": return d.cta ? party1Form(d) : reply(EXPIRED);
    case "p2": return d.cta && d.parties >= 2 ? party2Form(d) : reply(EXPIRED);
    case "copy": {
      if (!d.cta || d.parties < 2) return reply(EXPIRED);
      // Typed party 1 lines that did not parse are copied as typed, to be fixed in party 2.
      await saveCard(deps.sql, d.id, d.slotsText !== null ? { slots2: [], slots2Text: d.slotsText } : { slots2: d.slots.map(({ role, weapon, duty }) => ({ role, weapon, ...(duty ? { duty } : {}) })), slots2Text: null });
      return await showCard(deps, await reload(deps, d));
    }
    case "details": return detailsForm(d);
    case "blank": {
      if (!d.cta && !d.type) return await showCard(deps, d, { problems: ["Pick the type of content (PvP or PvE) first, then press Blank."] });
      return blankForm(d);
    }
    // Manage presets (ADR 0039): admins only, checked at every step. The panel replaces the card in the same message.
    case "presets": case "savepreset": case "delpreset": case "delpick": case "delyes": {
      if (!(await mayManagePresets(deps, i))) return reply(NOT_PRESET_ADMIN);
      if (action === "presets") return await presetPanel(deps, d);
      if (action === "savepreset") {
        const checked = validateCard(d, deps.now());
        if (!checked.ok) return await presetPanel(deps, d);
        return { type: MODAL, data: { custom_id: `ccp:${d.id}`, title: "Save as preset", components: [textInput("name", "Preset name", 50, { placeholder: "Ava roam" })] } };
      }
      if (action === "delpreset") {
        const presets = await listPresets(deps.sql, d.guildId, d.cta);
        if (presets.length === 0) return await presetPanel(deps, d, "This server has no presets to delete.");
        return { type: UPDATE_MESSAGE, data: renderPresetPanel(d.id, { kind: "pick", presets: presets.map((p) => ({ id: p.id, name: p.name, count: p.slots.length })) }) };
      }
      if (action === "delpick") {
        const found = value ? await getPresetById(deps.sql, d.guildId, value) : null;
        const preset = found && found.cta === d.cta ? found : null;
        if (!preset) return await presetPanel(deps, d, "That preset no longer exists.");
        return { type: UPDATE_MESSAGE, data: renderPresetPanel(d.id, { kind: "confirm", presetId: preset.id, name: escapeText(preset.name) }) };
      }
      const foundExtra = extra ? await getPresetById(deps.sql, d.guildId, extra) : null;
      const preset = foundExtra && foundExtra.cta === d.cta ? foundExtra : null;
      const gone = preset ? await deletePreset(deps.sql, d.guildId, preset.id) : false;
      return await presetPanel(deps, d, gone ? `🗑️ Deleted the preset **${escapeText(preset!.name)}**.` : "That preset no longer exists.");
    }
    case "back": return await showCard(deps, d);
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
  // A CTA's Details holds the text and the Bombers cap; each party's slots have their own button (owner request 2026-11-11).
  if (d.cta) {
    return {
      type: MODAL,
      data: {
        custom_id: `ccd:${d.id}`,
        title: "CTA details",
        components: [
          textInput("title", "Title", 100, { required: false, ...(d.title ? { value: d.title } : {}) }),
          textInput("start", "Start time (UTC, YYYY-MM-DD HH:mm)", 20, { required: false, placeholder: "2026-10-07 18:00", ...(d.startText ? { value: d.startText } : {}) }),
          textInput("tier", "Gear Tier", 80, { required: false, placeholder: "Weapon T7.1 - Gear T4.3", ...(d.gearTier ? { value: d.gearTier } : {}) }),
          textInput("notes", "Notes (optional)", 500, { style: 2, required: false, ...(d.notes ? { value: d.notes } : {}) }),
          textInput("bombers", "Bombers cap (1-20, empty = no Bombers)", 2, { required: false, placeholder: "10", ...(d.bombers ? { value: String(d.bombers) } : {}) }),
        ],
      },
    };
  }
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
        textInput("slots", d.cta && d.parties >= 2 ? "Party 1 slots (one per line: Role - Weapon)" : "Slots (one per line: Role - Weapon)", 1500, {
          style: 2, required: false, placeholder: d.cta ? "Tank - Axe" : "Tank - Axe  (the weapon is optional: Tank)", ...(slots ? { value: slots } : {}),
        }),
        textInput("notes", "Notes (optional)", 500, { style: 2, required: false, ...(d.notes ? { value: d.notes } : {}) }),
      ],
    },
  };
}

// Party 1 of a CTA (or its only party): its own form, one box of the same size as the Details slots.
function party1Form(d: StoredDraft): InteractionResponse {
  const text = d.slotsText ?? formatSlotLines(d.slots);
  const two = d.parties >= 2;
  return {
    type: MODAL,
    data: {
      custom_id: `ccs1:${d.id}`,
      title: two ? "Party 1 slots" : "Slots",
      components: [textInput("slots", two ? "Party 1 slots (one per line: Role - Weapon)" : "Slots (one per line: Role - Weapon)", 1500, { style: 2, required: false, placeholder: "Tank - Axe", ...(text ? { value: text } : {}) })],
    },
  };
}

// Party 2 of a CTA: its own form, one box of the same size as the Details slots.
function party2Form(d: StoredDraft): InteractionResponse {
  const text = d.slots2Text ?? formatSlotLines(d.slots2);
  return {
    type: MODAL,
    data: {
      custom_id: `ccs2:${d.id}`,
      title: "Party 2 slots",
      components: [textInput("slots2", "Party 2 slots", 1500, { style: 2, required: false, placeholder: "Tank - Axe", ...(text ? { value: text } : {}) })],
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
  if (d.cta) {
    // The Bombers cap is checked here; the slots of a CTA come from their own forms and are left as they are.
    const cap = parseBombersCap(v.bombers ?? "");
    await saveCard(deps.sql, d.id, {
      title: clean(v.title), startText: clean(v.start), gearTier: clean(v.tier), notes: clean(v.notes), ...(cap.ok ? { bombers: cap.value } : {}),
    });
    return await showCard(deps, await reload(deps, d), cap.ok ? {} : { problems: [cap.error] });
  }
  const typed = (v.slots ?? "").trim();
  const parsed = typed ? parseSlots(typed) : null;
  await saveCard(deps.sql, d.id, {
    title: clean(v.title), startText: clean(v.start), gearTier: clean(v.tier), notes: clean(v.notes),
    ...(parsed === null ? { slots: [], slotsText: null } : parsed.ok ? { slots: parsed.value, slotsText: null } : { slotsText: typed }),
  });
  return await showCard(deps, await reload(deps, d), parsed && !parsed.ok ? { problems: [`Slots: ${parsed.error}`] } : {});
}

// ccs1:<draft>: the Party 1 (or only) slots form of a CTA. Valid lines are stored; lines that fail are kept as typed, with the reason.
export async function handleCardParty1(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const [prefix, id, extra] = typeof raw === "string" ? raw.split(":") : [];
  if (prefix !== "ccs1" || extra !== undefined) return reply(EXPIRED);
  const d = await ownedDraft(deps, i, id);
  if (!d || !d.cta) return reply(EXPIRED);
  const typed = (modalValues(i).slots ?? "").trim();
  const parsed = typed ? parseCtaSlots(typed, 1, d.parties) : null;
  await saveCard(deps.sql, d.id, parsed === null ? { slots: [], slotsText: null } : parsed.ok ? { slots: parsed.value, slotsText: null } : { slotsText: typed });
  return await showCard(deps, await reload(deps, d), parsed && !parsed.ok ? { problems: [parsed.error] } : {});
}

// ccs2:<draft>: the Party 2 form of a CTA. Valid lines are stored; lines that fail are kept as typed, with the reason.
export async function handleCardParty2(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const [prefix, id, extra] = typeof raw === "string" ? raw.split(":") : [];
  if (prefix !== "ccs2" || extra !== undefined) return reply(EXPIRED);
  const d = await ownedDraft(deps, i, id);
  if (!d || !d.cta || d.parties < 2) return reply(EXPIRED);
  const typed = (modalValues(i).slots2 ?? "").trim();
  const parsed = typed ? parseCtaSlots(typed, 2, d.parties) : null;
  await saveCard(deps.sql, d.id, parsed === null ? { slots2: [], slots2Text: null } : parsed.ok ? { slots2: parsed.value, slots2Text: null } : { slots2Text: typed });
  return await showCard(deps, await reload(deps, d), parsed && !parsed.ok ? { problems: [parsed.error] } : {});
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

type Place = { forumId: string } | { channelId: string } | { threadId: string };
type Destination = { ok: true; place: Place } | { ok: false; problem: string };

// Where the content is posted (ADR 0036): a CTA in the CTA text channel (announced, with a thread for its roster), normal
// content in the event forum of its type. A card opened from an old launcher post still goes to that launcher's forum.
async function destinationOf(deps: Deps, d: StoredDraft, type: ContentType): Promise<Destination> {
  if (d.targetForumId) return { ok: true, place: { forumId: d.targetForumId } };
  if (d.cta) {
    const channel = await getCtaChannel(deps.sql, d.guildId);
    return channel ? { ok: true, place: { channelId: channel } } : { ok: false, problem: "No CTA channel is set. Ask an admin to run `/content setup` with `cta-channel`." };
  }
  const forum = pickEventForum(await listEventForums(deps.sql, d.guildId), type);
  return forum ? { ok: true, place: { forumId: forum.forumId } } : { ok: false, problem: `No event forum is set for ${TYPE_LABEL[type]} content. Ask an admin to run \`/content setup\` with \`event-forum\` and \`forum-type\` ${TYPE_LABEL[type]}.` };
}

// A CTA is checked again at Create: the roles may have changed since the card was opened.
async function ctaAllowed(deps: Deps, i: Interaction, d: StoredDraft): Promise<boolean> {
  if (!d.cta) return true;
  const actor = { userId: d.userId, roles: i.member?.roles ?? [], permissions: i.member?.permissions };
  return canCreateCta(actor, await getAdminRoleIds(deps.sql, d.guildId), await getCtaRoleIds(deps.sql, d.guildId));
}

const NOT_CTA = "Schedule CTA is for admins and members with a CTA role.";

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
    slots: c.slots, slots2: c.slots2, bombers: c.bombers, hasLoot: d.loot, selection: d.selection, cta: d.cta, buildRef: d.buildRef, place: where.place,
  });
  if (!done.ok) return done.response;
  await deleteDraft(deps.sql, d.id);
  const link = rosterUrl({ guildId: d.guildId, threadId: done.threadId, messageId: done.messageId, rosterChannelId: done.rosterChannelId });
  return { type: UPDATE_MESSAGE, data: v2Text([`✅ Created: ${link}`, ...done.notes].join("\n")) };
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
    slots: [], hasLoot: false, cta: fresh.cta, blank: true, buildRef: null, place: where.place,
  });
  if (!done.ok) return done.response;
  await deleteDraft(deps.sql, d.id);
  return { type: UPDATE_MESSAGE, data: v2Text([`✅ Created: ${rosterUrl({ guildId: d.guildId, threadId: done.threadId, messageId: done.messageId, rosterChannelId: done.rosterChannelId })}`, ...done.notes].join("\n")) };
}

// A form or panel of an earlier version (the first form, the create panel): it no longer exists.
export async function handleOldCreate(): Promise<InteractionResponse> {
  return reply("This is from an earlier version. Press **Plan Content** or **Schedule CTA** in the content-management channel.");
}


// Save as preset (ADR 0039): only admins (the admin roles, Manage Server or Administrator, like the setup), checked again when the form comes back.
const NOT_PRESET_ADMIN = "Only admins (an admin role or Manage Server) can save presets.";

async function mayManagePresets(deps: Deps, i: Interaction): Promise<boolean> {
  const userId = i.member?.user?.id;
  if (!i.guild_id || !userId) return false;
  return canManagePresets({ userId, roles: i.member?.roles ?? [], permissions: i.member?.permissions }, await getAdminRoleIds(deps.sql, i.guild_id));
}

// ccp:<draft>: the Save as preset form. A name that exists is replaced.
export async function handleCardSavePreset(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const [prefix, id, extra] = typeof raw === "string" ? raw.split(":") : [];
  if (prefix !== "ccp" || extra !== undefined) return reply(EXPIRED);
  const d = await ownedDraft(deps, i, id);
  const userId = i.member?.user?.id;
  if (!d || !userId) return reply(EXPIRED);
  if (!(await mayManagePresets(deps, i))) return reply(NOT_PRESET_ADMIN);
  const name = parsePresetName(modalValues(i).name ?? "");
  if (!name.ok) return await presetPanel(deps, d, `⚠️ ${name.error}`);
  // Only a card that is valid for Create can be saved as a preset (owner request 2026-11-07): the same checks, again here.
  const checked = validateCard(d, deps.now());
  if (!checked.ok) return await presetPanel(deps, d);
  const settings: PresetSettings = {
    type: d.type, kind: d.kind, loot: d.loot, selection: d.selection, title: d.title, tier: d.gearTier, notes: d.notes, buildRef: d.buildRef,
    bombers: d.cta ? d.bombers : null,
  };
  // Party 2 slots are saved with `party: 2`; party 1 slots have no party key, as in older presets.
  const presetSlots = [...checked.value.slots, ...checked.value.slots2.map((s) => ({ ...s, party: 2 }))];
  const result = await savePreset(deps.sql, { guildId: d.guildId, name: name.value, slots: presetSlots, createdBy: userId, settings, cta: d.cta });
  if (result === "name_taken") return await presetPanel(deps, d, `⚠️ A ${d.cta ? "normal-content" : "CTA"} preset already uses that name. Pick another name.`);
  if (result === "full") return await presetPanel(deps, d, `⚠️ This server already has ${MAX_PRESETS} ${d.cta ? "CTA " : ""}presets. Save under an existing name to replace one, or delete one first.`);
  const label = escapeText(name.value);
  return await presetPanel(deps, d, result === "replaced" ? `💾 The preset **${label}** was replaced with these ${presetSlots.length} positions.` : `💾 Saved the preset **${label}** with ${presetSlots.length} positions.`);
}

// What picking a preset sets on the card: everything it kept except the start time. A category that does not fit the type goes back to Other.
function presetFields(s: PresetSettings | null, cta: boolean) {
  if (!s) return {};
  const type = s.type ?? undefined;
  const kind = type && s.kind && resolveKind(type, s.kind).ok ? s.kind : DEFAULT_KIND;
  return {
    ...(type ? { type, kind } : {}), loot: s.loot, selection: s.selection,
    title: s.title, gearTier: s.tier, notes: s.notes, buildRef: s.buildRef,
    ...(cta ? { bombers: s.bombers } : {}),
  };
}

// The Manage presets panel for this card: what can be saved now, what is missing, and whether there is anything to delete.
async function presetPanel(deps: Deps, d: StoredDraft, note?: string): Promise<InteractionResponse> {
  const fresh = await reload(deps, d);
  const checked = validateCard(fresh, deps.now());
  const hasPresets = (await listPresets(deps.sql, fresh.guildId, fresh.cta)).length > 0;
  return { type: UPDATE_MESSAGE, data: renderPresetPanel(fresh.id, { kind: "main", ready: checked.ok, problems: checked.ok ? [] : checked.problems, hasPresets, note }) };
}
