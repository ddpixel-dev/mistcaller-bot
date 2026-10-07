import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, MODAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { leafOption, modalValues, textInput } from "../discord/modal.ts";
import { WEAPONS } from "../data/weapons.ts";
import { deleteDraft, findDraft, getDraft, saveDraft, startDraft, type StoredDraft } from "../db/draft.ts";
import {
  GUIDED_ROLES, back, fillRest, isComplete, next, parseCount, sameAsPrevious, setCount, setDuty, setRole, setWeapon,
  type GuidedDraft,
} from "../domain/guided.ts";
import { resolveKind } from "../domain/kinds.ts";
import { formatSlotLines } from "../domain/slots.ts";
import { renderGuidedStep, TYPED_WEAPON } from "../render/guided.ts";
import { createForm, inContentPost, postTakenReply } from "./create.ts";
import { createPanel } from "./create-panel.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPIRED = "These steps expired or are not yours. Run `/content create` and start again.";
const NOT_FORUM = "Use this command inside a post in a content forum.";

const update = (d: StoredDraft): InteractionResponse => ({ type: UPDATE_MESSAGE, data: renderGuidedStep(d) });
const picked = (d: GuidedDraft) => ({ count: d.count, slots: d.slots, step: d.step, role: d.role, weapon: d.weapon, duty: d.duty });

async function store(deps: Deps, d: StoredDraft, next: GuidedDraft, query: string | null = d.query): Promise<StoredDraft> {
  const out = { ...d, ...picked(next), query };
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
  draft: { type: "pvp" | "pve"; loot: boolean; kind: string },
): Promise<InteractionResponse> {
  const userId = i.member?.user?.id;
  const threadId = i.channel?.id;
  if (!i.guild_id || !userId || !threadId) return reply(EXPIRED);
  const id = await startDraft(deps.sql, { guildId: i.guild_id, userId, threadId, type: draft.type, loot: draft.loot, kind: draft.kind });
  const d = await getDraft(deps.sql, id, deps.now());
  return d ? countForm(d) : reply(EXPIRED);
}

async function owned(deps: Deps, i: Interaction, id: string | undefined): Promise<StoredDraft | null> {
  if (!id || !UUID.test(id)) return null;
  const d = await getDraft(deps.sql, id, deps.now());
  if (!d || d.guildId !== i.guild_id || d.userId !== i.member?.user?.id || d.threadId !== i.channel?.id) return null;
  return d;
}

const searchForm = (d: StoredDraft): InteractionResponse => ({
  type: MODAL,
  data: {
    custom_id: `gsq:${d.id}`,
    title: "Search weapon",
    components: [textInput("weapon", "Part of a name, or a class like Holy", 50, { placeholder: "great axe", ...(d.query ? { value: d.query } : {}) })],
  },
});

export async function handleGuidedComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = i.data as { custom_id?: unknown; values?: unknown } | undefined;
  const [prefix, action, id, extra] = typeof data?.custom_id === "string" ? data.custom_id.split(":") : [];
  if (prefix !== "gs" || extra !== undefined) return reply(EXPIRED);
  const d = await owned(deps, i, id);
  if (!d) return reply(EXPIRED);
  const value = Array.isArray(data?.values) && data!.values.length === 1 ? data!.values[0] : undefined;

  switch (action) {
    case "role": return update(await store(deps, d, typeof value === "string" ? setRole(d, value) : d));
    case "duty": return update(await store(deps, d, typeof value === "string" ? setDuty(d, value) : d));
    case "weapon": {
      if (value === TYPED_WEAPON) return update(d);
      const w = typeof value === "string" ? WEAPONS.find((x) => x.base === value) : undefined;
      if (!w) return reply(EXPIRED);
      return update(await store(deps, d, setWeapon(d, w.name)));
    }
    case "next": return update(await store(deps, d, next(d), null));
    case "same": return update(await store(deps, d, sameAsPrevious(d)));
    case "rest": return update(await store(deps, d, fillRest(d), null));
    case "search": return searchForm(d);
    case "clear": return update(await store(deps, d, d, null));
    case "count": return countForm(d);
    case "back": {
      if (d.count !== null && d.step > 0) return update(await store(deps, d, back(d)));
      // On the first card, Back returns to the create panel with the choices kept.
      if (!i.guild_id) return reply(EXPIRED);
      return await createPanel(deps, i.guild_id, { type: d.type, loot: d.loot, kind: d.kind, presetId: null }, "update");
    }
    case "cancel": {
      await deleteDraft(deps.sql, d.id);
      return { type: UPDATE_MESSAGE, data: { content: "Creation cancelled.", embeds: [], components: [] } };
    }
    case "done": {
      if (!isComplete(d)) return update(d);
      if (!i.guild_id || !(await inContentPost(deps, i))) return reply(NOT_FORUM);
      const kind = resolveKind(d.type, d.kind);
      if (!kind.ok) return reply(kind.error);
      const taken = i.channel?.id ? await postTakenReply(deps, i.guild_id, i.channel.id) : null;
      if (taken) return taken;
      return createForm({ type: d.type, loot: d.loot, kind: kind.value }, formatSlotLines(d.slots));
    }
    default: return reply(EXPIRED);
  }
}

// Two small forms: the number of players ("gsc") and the weapon search ("gsq").
export async function handleGuidedModal(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const [prefix, id, extra] = typeof raw === "string" ? raw.split(":") : [];
  if ((prefix !== "gsq" && prefix !== "gsc") || extra !== undefined) return reply(EXPIRED);
  const d = await owned(deps, i, id);
  if (!d) return reply(EXPIRED);
  const values = modalValues(i);

  if (prefix === "gsc") {
    const count = parseCount(values.count ?? "");
    if (!count.ok) return reply(count.error);
    return update(await store(deps, d, setCount(d, count.value)));
  }
  const query = (values.weapon ?? "").trim().slice(0, 50);
  return update(await store(deps, d, d, query || null));
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
  if (!typed) return reply("Type part of a weapon name and pick one from the list.");
  if (typed.length > 40) return reply("That weapon name is too long (max 40 characters).");
  const known = WEAPONS.find((w) => w.name.toLowerCase() === typed.toLowerCase());

  let draft: GuidedDraft = setWeapon(setRole(picked(d), role), known ? known.name : typed);
  if (typeof duty === "string") draft = setDuty(draft, duty);
  const saved = await store(deps, d, next(draft), null);
  return { type: CHANNEL_MESSAGE, data: { ...renderGuidedStep(saved), flags: EPHEMERAL } };
}
