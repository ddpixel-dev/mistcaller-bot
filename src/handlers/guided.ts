import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, MODAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { leafOption, modalValues, textInput } from "../discord/modal.ts";
import { WEAPONS } from "../data/weapons.ts";
import { deleteDraft, findDraft, getDraft, saveDraft, startDraft, type StoredDraft } from "../db/draft.ts";
import {
  GUIDED_ROLES, back, fillRest, isComplete, parseCounts, sameAsPrevious, setCounts, setWeapon, type GuidedDraft,
} from "../domain/guided.ts";
import { resolveKind } from "../domain/kinds.ts";
import { formatSlotLines } from "../domain/slots.ts";
import { renderGuidedStep } from "../render/guided.ts";
import { createForm, inContentPost, postTakenReply } from "./create.ts";
import { checked } from "./create-panel.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPIRED = "These steps expired or are not yours. Run `/content create` and start again.";
const NOT_FORUM = "Use this command inside a post in the PvP or PvE content forum.";

const update = (d: StoredDraft): InteractionResponse => ({ type: UPDATE_MESSAGE, data: renderGuidedStep(d) });

async function store(deps: Deps, d: StoredDraft, next: GuidedDraft, query: string | null): Promise<StoredDraft> {
  const out = { ...d, ...next, query };
  await saveDraft(deps.sql, d.id, out);
  return out;
}

// The "Guided steps" choice after Continue: start (or restart) this member's draft for this post.
export async function handleGuidedStart(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const userId = i.member?.user?.id;
  const threadId = i.channel?.id;
  if (!i.guild_id || !userId || !threadId) return reply(EXPIRED);
  const c = await checked(deps, i, "cpgs");
  if (!c.ok) return c.response;
  const id = await startDraft(deps.sql, {
    guildId: i.guild_id, userId, threadId, type: c.draft.type, loot: c.draft.loot, kind: c.draft.kind,
  });
  const d = await getDraft(deps.sql, id, deps.now());
  return d ? update(d) : reply(EXPIRED);
}

async function owned(deps: Deps, i: Interaction, id: string | undefined): Promise<StoredDraft | null> {
  if (!id || !UUID.test(id)) return null;
  const d = await getDraft(deps.sql, id, deps.now());
  if (!d || d.guildId !== i.guild_id || d.userId !== i.member?.user?.id || d.threadId !== i.channel?.id) return null;
  return d;
}

const rolesForm = (d: StoredDraft): InteractionResponse => ({
  type: MODAL,
  data: {
    custom_id: `gsr:${d.id}`,
    title: "How many of each role?",
    components: GUIDED_ROLES.map((role, r) =>
      textInput(`r${r}`, role, 2, { required: false, placeholder: "0", ...(d.counts ? { value: String(d.counts[r]) } : {}) }),
    ),
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
    case "roles": return rolesForm(d);
    case "pick": {
      const w = typeof value === "string" ? WEAPONS.find((x) => x.base === value) : undefined;
      if (!w) return reply(EXPIRED);
      return update(await store(deps, d, setWeapon(d, w.name), null));
    }
    case "typed": {
      if (!d.query) return reply(EXPIRED);
      return update(await store(deps, d, setWeapon(d, d.query), null));
    }
    case "find": {
      return {
        type: MODAL,
        data: {
          custom_id: `gsq:${d.id}`,
          title: "Find a weapon",
          components: [textInput("weapon", "Part of the weapon name", 50, { placeholder: "great axe" })],
        },
      };
    }
    case "same": return update(await store(deps, d, sameAsPrevious(d), null));
    case "rest": return update(await store(deps, d, fillRest(d), null));
    case "back": return update(await store(deps, d, back(d), null));
    case "cancel": {
      await deleteDraft(deps.sql, d.id);
      return { type: UPDATE_MESSAGE, data: { content: "Guided slots cancelled.", embeds: [], components: [] } };
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

// Two small forms: the role numbers ("gsr") and the weapon search ("gsq").
export async function handleGuidedModal(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const [prefix, id, extra] = typeof raw === "string" ? raw.split(":") : [];
  if ((prefix !== "gsq" && prefix !== "gsr") || extra !== undefined) return reply(EXPIRED);
  const d = await owned(deps, i, id);
  if (!d) return reply(EXPIRED);
  const values = modalValues(i);

  if (prefix === "gsr") {
    const counts = parseCounts(GUIDED_ROLES.map((_, r) => values[`r${r}`] ?? ""));
    if (!counts.ok) return reply(counts.error);
    return update(await store(deps, d, setCounts(d, counts.value), null));
  }
  const query = (values.weapon ?? "").trim().slice(0, 50);
  if (!query) return update(d);
  return update(await store(deps, d, d, query));
}

// "/content slot weapon:<type to search>": the fast way to add the next slot's weapon.
export async function handleSlotCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const userId = i.member?.user?.id;
  const threadId = i.channel?.id;
  if (!i.guild_id || !userId || !threadId) return reply("Use this command inside a content post.");
  const d = await findDraft(deps.sql, { guildId: i.guild_id, threadId, userId }, deps.now());
  if (!d) return reply("Start the guided steps first: `/content create`, then Continue, then Guided steps.");
  const raw = leafOption(i, "weapon");
  const typed = typeof raw === "string" ? raw.trim() : "";
  if (!typed) return reply("Type part of a weapon name and pick one from the list.");
  if (d.counts === null) return reply("Set the roles first: press Set roles on the guided card.");
  if (isComplete(d)) return reply("All slots are chosen. Press Continue to form on the guided card.");
  const known = WEAPONS.find((w) => w.name.toLowerCase() === typed.toLowerCase());
  const weapon = known ? known.name : typed;
  if (weapon.length > 40) return reply("That weapon name is too long (max 40 characters).");
  const next = await store(deps, d, setWeapon(d, weapon), null);
  return { type: CHANNEL_MESSAGE, data: { ...renderGuidedStep(next), flags: EPHEMERAL } };
}
