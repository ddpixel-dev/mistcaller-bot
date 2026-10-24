import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { modalValues } from "../discord/modal.ts";
import { WEAPONS } from "../data/weapons.ts";
import { deleteDraft, getDraft, saveCard, saveDraft, type StoredDraft } from "../db/draft.ts";
import {
  NO_DUTY, back, fillRest, isComplete, next, parseCount, sameAsPrevious, setCount, setDuty, setRole, setWeapon, type GuidedDraft,
} from "../domain/guided.ts";
import { renderGuidedStep, TYPED_WEAPON } from "../render/guided.ts";
import { isWeaponClass, weaponClass } from "../domain/weapons.ts";
import { showCard } from "./card.ts";
import { v2Text } from "../render/card.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPIRED = "These steps expired or are not yours. Run `/content create` and start again.";

const update = (d: StoredDraft): InteractionResponse => ({ type: UPDATE_MESSAGE, data: renderGuidedStep(d) });
const picked = (d: GuidedDraft) => ({ count: d.count, slots: d.slots, step: d.step, role: d.role, weapon: d.weapon, duty: d.duty });

async function store(deps: Deps, d: StoredDraft, next: GuidedDraft, weaponClass: string | null = d.weaponClass): Promise<StoredDraft> {
  const out = { ...d, ...picked(next), weaponClass };
  await saveDraft(deps.sql, d.id, out);
  return out;
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
    // Change number: the number menu over the cards. Picking a number keeps the slots that still fit.
    case "count": return { type: UPDATE_MESSAGE, data: renderGuidedStep(d, true) };
    case "setcount": {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 20) return reply(EXPIRED);
      return update(await store(deps, d, setCount(d, n)));
    }
    case "back": {
      if (d.count !== null && d.step > 0) return update(await store(deps, d, back(d), null));
      // Back on the first slot shows the number menu, so the number can change (owner request 2026-10-24); from there
      // Back to the card returns to the creation card.
      if (d.count !== null) return { type: UPDATE_MESSAGE, data: renderGuidedStep(d, true) };
      return await showCard(deps, d);
    }
    case "card": return await showCard(deps, d);
    case "cancel": {
      await deleteDraft(deps.sql, d.id);
      return { type: UPDATE_MESSAGE, data: v2Text("Creation cancelled.") };
    }
    // Use these slots: back to the creation card, which now shows them (typed slots that did not parse are replaced).
    case "done": {
      if (!isComplete(d)) return update(d);
      await saveCard(deps.sql, d.id, { slotsText: null });
      return await showCard(deps, (await getDraft(deps.sql, d.id, deps.now())) ?? d);
    }
    default: return reply(EXPIRED);
  }
}

// The number form of an earlier version ("gsc"); the number is a menu now.
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
