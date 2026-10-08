import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, MODAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { leafOption, modalValues, textInput } from "../discord/modal.ts";
import { WEAPONS } from "../data/weapons.ts";
import { deleteDraft, findDraft, getDraft, saveDraft, startDraft, type StoredDraft } from "../db/draft.ts";
import {
  GUIDED_ROLES, NO_DUTY, back, fillRest, isComplete, next, parseCount, sameAsPrevious, setCount, setDuty, setRole, setWeapon,
  type GuidedDraft,
} from "../domain/guided.ts";
import { resolveKind } from "../domain/kinds.ts";
import { formatSlotLines } from "../domain/slots.ts";
import { renderGuidedStep, TYPED_WEAPON } from "../render/guided.ts";
import { isWeaponClass, weaponClass } from "../domain/weapons.ts";
import type { ContentType } from "../domain/types.ts";
import { NOT_HERE, createForm, placeProblem, postTakenReply } from "./create.ts";
import { createPanel } from "./create-panel.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPIRED = "These steps expired or are not yours. Run `/content create` and start again.";

const update = (d: StoredDraft): InteractionResponse => ({ type: UPDATE_MESSAGE, data: renderGuidedStep(d) });
const picked = (d: GuidedDraft) => ({ count: d.count, slots: d.slots, step: d.step, role: d.role, weapon: d.weapon, duty: d.duty });

async function store(deps: Deps, d: StoredDraft, next: GuidedDraft, weaponClass: string | null = d.weaponClass): Promise<StoredDraft> {
  const out = { ...d, ...picked(next), weaponClass };
  await saveDraft(deps.sql, d.id, out);
  return out;
}

const countForm = (d: StoredDraft): InteractionResponse => ({
  type: MODAL,
  data: {
    custom_id: `gsc:${d.id}`,
    title: "How many players needed?",
    components: [textInput("count", "Players (1 to 20)", 3, { placeholder: "10", ...(d.count ? { value: String(d.count) } : {}) })],
  },
});

// Continue in the create panel (no preset): start this member's draft and ask how many players.
export async function startGuided(
  deps: Deps,
  i: Interaction,
  draft: { type: ContentType; loot: boolean; kind: string; buildChannelId?: string | null },
): Promise<InteractionResponse> {
  const userId = i.member?.user?.id;
  const threadId = i.channel?.id;
  if (!i.guild_id || !userId || !threadId) return reply(EXPIRED);
  const id = await startDraft(deps.sql, { guildId: i.guild_id, userId, threadId, type: draft.type, loot: draft.loot, kind: draft.kind, buildChannelId: draft.buildChannelId ?? null });
  const d = await getDraft(deps.sql, id, deps.now());
  return d ? countForm(d) : reply(EXPIRED);
}

async function owned(deps: Deps, i: Interaction, id: string | undefined): Promise<StoredDraft | null> {
  if (!id || !UUID.test(id)) return null;
  const d = await getDraft(deps.sql, id, deps.now());
  if (!d || d.guildId !== i.guild_id || d.userId !== i.member?.user?.id || d.threadId !== i.channel?.id) return null;
  return d;
}

export async function handleGuidedComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = i.data as { custom_id?: unknown; values?: unknown } | undefined;
  const [prefix, action, id, extra] = typeof data?.custom_id === "string" ? data.custom_id.split(":") : [];
  if (prefix !== "gs" || extra !== undefined) return reply(EXPIRED);
  const d = await owned(deps, i, id);
  if (!d) return reply(EXPIRED);
  const value = Array.isArray(data?.values) && data!.values.length === 1 ? data!.values[0] : undefined;

  switch (action) {
    case "role": return update(await store(deps, d, typeof value === "string" ? setRole(d, value) : d));
    case "duty": {
      // Deselecting sends no value: that clears the duty.
      const picks = Array.isArray(data?.values) ? data!.values : null;
      if (picks && picks.length === 0) return update(await store(deps, d, setDuty(d, NO_DUTY)));
      return update(await store(deps, d, typeof value === "string" ? setDuty(d, value) : d));
    }
    case "weapon": {
      // The weapon is optional: deselecting sends no value, which clears it.
      const picks = Array.isArray(data?.values) ? data!.values : null;
      if (picks && picks.length === 0) return update(await store(deps, d, { ...d, weapon: null }));
      if (value === TYPED_WEAPON) return update(d);
      const w = typeof value === "string" ? WEAPONS.find((x) => x.base === value) : undefined;
      if (!w) return reply(EXPIRED);
      return update(await store(deps, d, setWeapon(d, w.name), weaponClass(w)));
    }
    case "next": return update(await store(deps, d, next(d), null));
    case "same": return update(await store(deps, d, sameAsPrevious(d), null));
    case "rest": return update(await store(deps, d, fillRest(d), null));
    case "class": {
      // Deselecting the class (it is optional) clears the weapon with it.
      const picks = Array.isArray(data?.values) ? data!.values : null;
      if (picks && picks.length === 0) return update(await store(deps, d, { ...d, weapon: null }, null));
      const cls = typeof value === "string" ? value : "";
      if (!isWeaponClass(cls)) return reply(EXPIRED);
      return update(await store(deps, d, d, cls));
    }
    case "count": return countForm(d);
    case "back": {
      if (d.count !== null && d.step > 0) return update(await store(deps, d, back(d), null));
      // On the first card, Back returns to the create panel with the choices kept.
      if (!i.guild_id) return reply(EXPIRED);
      return await createPanel(deps, i.guild_id, { type: d.type, loot: d.loot, kind: d.kind, presetId: null, buildChannelId: d.buildChannelId }, "update");
    }
    case "cancel": {
      await deleteDraft(deps.sql, d.id);
      return { type: UPDATE_MESSAGE, data: { content: "Creation cancelled.", embeds: [], components: [] } };
    }
    case "done": {
      if (!isComplete(d)) return update(d);
      if (!i.guild_id) return reply(NOT_HERE);
      const problem = placeProblem(i);
      if (problem) return reply(problem);
      const kind = resolveKind(d.type, d.kind);
      if (!kind.ok) return reply(kind.error);
      const taken = i.channel?.id ? await postTakenReply(deps, i.guild_id, i.channel.id) : null;
      if (taken) return taken;
      return createForm({ type: d.type, loot: d.loot, kind: kind.value, buildChannelId: d.buildChannelId }, formatSlotLines(d.slots));
    }
    default: return reply(EXPIRED);
  }
}

// The form for the number of players ("gsc").
export async function handleGuidedModal(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const [prefix, id, extra] = typeof raw === "string" ? raw.split(":") : [];
  if (prefix !== "gsc" || extra !== undefined) return reply(EXPIRED);
  const d = await owned(deps, i, id);
  if (!d) return reply(EXPIRED);
  const values = modalValues(i);

  const count = parseCount(values.count ?? "");
  if (!count.ok) return reply(count.error);
  return update(await store(deps, d, setCount(d, count.value)));
}

// "/content slot role:<> weapon:<type to search> duty:<>": fill the current card in one command and move on.
export async function handleSlotCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const userId = i.member?.user?.id;
  const threadId = i.channel?.id;
  if (!i.guild_id || !userId || !threadId) return reply("Use this command inside a content post.");
  const d = await findDraft(deps.sql, { guildId: i.guild_id, threadId, userId }, deps.now());
  if (!d) return reply("Start the guided steps first: `/content create`, pick the type, then Continue.");
  if (d.count === null) return reply("Set the number of players first, with Set number on the guided card.");
  if (isComplete(d)) return reply("All slots are chosen. Press Continue to form on the guided card.");

  const role = leafOption(i, "role");
  const rawWeapon = leafOption(i, "weapon");
  const duty = leafOption(i, "duty");
  if (typeof role !== "string" || !(GUIDED_ROLES as readonly string[]).includes(role)) return reply("Pick a role from the list.");
  const typed = typeof rawWeapon === "string" ? rawWeapon.trim() : "";
  if (typed.length > 40) return reply("That weapon name is too long (max 40 characters).");
  const known = WEAPONS.find((w) => w.name.toLowerCase() === typed.toLowerCase());

  // The weapon is optional: without one the slot is a role alone.
  let draft: GuidedDraft = typed ? setWeapon(setRole(picked(d), role), known ? known.name : typed) : { ...setRole(picked(d), role), weapon: null };
  if (typeof duty === "string") draft = setDuty(draft, duty);
  const saved = await store(deps, d, next(draft), null);
  return { type: CHANNEL_MESSAGE, data: { ...renderGuidedStep(saved), flags: EPHEMERAL } };
}
