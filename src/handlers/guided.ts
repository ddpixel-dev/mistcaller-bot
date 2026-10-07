import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { MODAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { modalValues, textInput } from "../discord/modal.ts";
import { WEAPONS } from "../data/weapons.ts";
import { deleteDraft, getDraft, saveDraft, startDraft, type StoredDraft } from "../db/draft.ts";
import {
  back, fillRest, isComplete, sameAsPrevious, setCount, setRole, setWeapon, type GuidedDraft,
} from "../domain/guided.ts";
import { resolveKind } from "../domain/kinds.ts";
import { formatSlotLines } from "../domain/slots.ts";
import { renderGuidedStep } from "../render/guided.ts";
import { createForm, forumType, postTakenReply } from "./create.ts";
import { decodeDraft } from "./create-panel.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPIRED = "These steps expired or are not yours. Run `/content create` and start again.";
const NOT_FORUM = "Use this command inside a post in the PvP or PvE content forum.";

const update = (d: StoredDraft): InteractionResponse => ({ type: UPDATE_MESSAGE, data: renderGuidedStep(d) });

async function store(deps: Deps, d: StoredDraft, next: GuidedDraft, query: string | null): Promise<StoredDraft> {
  const out = { ...d, ...next, query };
  await saveDraft(deps.sql, d.id, out);
  return out;
}

// The panel's "Guided slots" button: start (or restart) this member's draft for this post.
export async function handleGuidedStart(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const parts = typeof raw === "string" ? raw.split(":") : [];
  const draft = parts[0] === "cpgs" ? decodeDraft(parts.slice(1)) : null;
  const userId = i.member?.user?.id;
  const threadId = i.channel?.id;
  if (!draft || !i.guild_id || !userId || !threadId) return reply(EXPIRED);
  const type = await forumType(deps, i);
  if (type === null) return reply(NOT_FORUM);
  const kind = resolveKind(type, draft.kind);
  if (!kind.ok) return reply(kind.error);
  const taken = await postTakenReply(deps, i.guild_id, threadId);
  if (taken) return taken;
  const id = await startDraft(deps.sql, {
    guildId: i.guild_id, userId, threadId, loot: draft.loot, kind: kind.value,
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

export async function handleGuidedComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = i.data as { custom_id?: unknown; values?: unknown } | undefined;
  const [prefix, action, id, extra] = typeof data?.custom_id === "string" ? data.custom_id.split(":") : [];
  if (prefix !== "gs" || extra !== undefined) return reply(EXPIRED);
  const d = await owned(deps, i, id);
  if (!d) return reply(EXPIRED);
  const value = Array.isArray(data?.values) && data!.values.length === 1 ? data!.values[0] : undefined;
  const before = d.slots.length;
  const settled = (next: GuidedDraft) => (next.slots.length > before || next.slots.length < before ? null : d.query);

  switch (action) {
    case "count": {
      const n = typeof value === "string" ? Number(value) : NaN;
      return update(await store(deps, d, setCount(d, n), null));
    }
    case "role": {
      const next = typeof value === "string" ? setRole(d, value) : d;
      return update(await store(deps, d, next, settled(next)));
    }
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
      const type = await forumType(deps, i);
      if (type === null || !i.guild_id) return reply(NOT_FORUM);
      const kind = resolveKind(type, d.kind);
      if (!kind.ok) return reply(kind.error);
      const taken = i.channel?.id ? await postTakenReply(deps, i.guild_id, i.channel.id) : null;
      if (taken) return taken;
      return createForm({ loot: d.loot, kind: kind.value, presetId: null }, formatSlotLines(d.slots));
    }
    default: return reply(EXPIRED);
  }
}

// The weapon search form: the typed text is searched against the weapon list.
export async function handleGuidedModal(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const [prefix, id, extra] = typeof raw === "string" ? raw.split(":") : [];
  if (prefix !== "gsq" || extra !== undefined) return reply(EXPIRED);
  const d = await owned(deps, i, id);
  if (!d) return reply(EXPIRED);
  const query = (modalValues(i).weapon ?? "").trim().slice(0, 50);
  if (!query) return update(d);
  return update(await store(deps, d, d, query));
}
