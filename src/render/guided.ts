import type { StoredDraft } from "../db/draft.ts";
import { WEAPONS } from "../data/weapons.ts";
import { GUIDED_ROLES, MAX_SLOTS, isComplete } from "../domain/guided.ts";
import { SLOT_LABEL, searchWeapons, weaponIconUrl } from "../domain/weapons.ts";
import { escapeText } from "./roster.ts";

const btn = (label: string, id: string, extra: Record<string, unknown> = {}) => ({
  type: 2, style: 2, label, custom_id: id, ...extra,
});

// One screen of the guided steps, rebuilt from the stored draft after every click.
export function renderGuidedStep(d: StoredDraft) {
  const id = d.id;
  const done = d.count !== null && isComplete(d);
  const lines = d.slots.map((s, i) => `${i + 1}. ${escapeText(s.role)} - ${escapeText(s.weapon)}`);
  const matches = d.query ? searchWeapons(WEAPONS, d.query, 25) : [];
  const shown = matches[0] ?? WEAPONS.find((w) => w.name === d.weapon);

  const embed: Record<string, unknown> = { title: "Guided slots" };
  const body: string[] = [];
  if (d.count === null) {
    body.push("How many members does this content need?");
  } else {
    body.push(done ? `All ${d.count} slots are chosen.` : `**Slot ${d.slots.length + 1} of ${d.count}**`);
    if (lines.length) body.push("", ...lines);
    if (!done) {
      body.push("", `Role: ${d.role ? escapeText(d.role) : "pick one below"}`);
      body.push(`Weapon: ${d.weapon ? escapeText(d.weapon) : d.query ? `searching "${escapeText(d.query)}"` : "press Find weapon"}`);
      if (d.query && matches.length === 0) body.push(`No weapon matches "${escapeText(d.query)}". Search again, or use it as typed.`);
    }
  }
  embed.description = body.join("\n");
  if (shown && !done) embed.thumbnail = { url: weaponIconUrl(shown, 128) };

  const rows: unknown[] = [];
  if (d.count === null) {
    rows.push({
      type: 1,
      components: [{
        type: 3, custom_id: `gs:count:${id}`, placeholder: "Number of members",
        options: Array.from({ length: MAX_SLOTS }, (_, i) => ({ label: `${i + 1}`, value: `${i + 1}` })),
      }],
    });
    rows.push({ type: 1, components: [btn("Cancel", `gs:cancel:${id}`)] });
  } else if (done) {
    rows.push({
      type: 1,
      components: [
        btn("Continue to form", `gs:done:${id}`, { style: 3 }),
        btn("Back", `gs:back:${id}`),
        btn("Cancel", `gs:cancel:${id}`),
      ],
    });
  } else {
    rows.push({
      type: 1,
      components: [{
        type: 3, custom_id: `gs:role:${id}`, placeholder: "Role",
        options: GUIDED_ROLES.map((r) => ({ label: r, value: r, default: r === d.role })),
      }],
    });
    if (matches.length > 0) {
      rows.push({
        type: 1,
        components: [{
          type: 3, custom_id: `gs:pick:${id}`, placeholder: "Pick the weapon",
          options: matches.map((w) => ({ label: `${w.name} (${SLOT_LABEL[w.slot]})`.slice(0, 100), value: w.base })),
        }],
      });
    }
    const first = d.slots.length === 0;
    rows.push({
      type: 1,
      components: [
        btn("Find weapon", `gs:find:${id}`, { style: 1 }),
        btn("Same as previous", `gs:same:${id}`, { disabled: first }),
        btn("Fill the rest", `gs:rest:${id}`, { disabled: first }),
        btn("Back", `gs:back:${id}`, { disabled: first && !d.role && !d.weapon }),
        btn("Cancel", `gs:cancel:${id}`),
      ],
    });
    if (d.query) rows.push({ type: 1, components: [btn(`Use "${d.query}" as typed`.slice(0, 80), `gs:typed:${id}`)] });
  }
  return { content: "", embeds: [embed], components: rows, allowed_mentions: { parse: [] as [] } };
}
