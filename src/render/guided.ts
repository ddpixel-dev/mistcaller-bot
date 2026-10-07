import type { StoredDraft } from "../db/draft.ts";
import { WEAPONS } from "../data/weapons.ts";
import { GUIDED_ROLES, isComplete, nextRole, total } from "../domain/guided.ts";
import { SLOT_LABEL, searchWeapons, weaponIconUrl } from "../domain/weapons.ts";
import { escapeText } from "./roster.ts";

const btn = (label: string, id: string, extra: Record<string, unknown> = {}) => ({
  type: 2, style: 2, label, custom_id: id, ...extra,
});

export const rolesSummary = (counts: number[]): string =>
  GUIDED_ROLES.map((r, i) => `${counts[i]} ${r}`).join(" · ");

// One screen of the guided steps, rebuilt from the stored draft after every click.
export function renderGuidedStep(d: StoredDraft) {
  const id = d.id;
  const done = d.counts !== null && isComplete(d);
  const lines = d.slots.map((s, i) => `${i + 1}. ${escapeText(s.role)} - ${escapeText(s.weapon)}`);
  const matches = d.query ? searchWeapons(WEAPONS, d.query, 25) : [];
  const shown = matches[0];

  const embed: Record<string, unknown> = { title: "Guided slots" };
  const body: string[] = [];
  if (d.counts === null) {
    body.push("How many of each role does this content need? Press **Set roles** and type the numbers.");
  } else {
    body.push(`**${rolesSummary(d.counts)}** (${total(d)} members)`);
    body.push(done ? "All slots are chosen." : `**Slot ${d.slots.length + 1} of ${total(d)} · ${nextRole(d)}**`);
    if (lines.length) body.push("", ...lines);
    if (!done) {
      body.push("", "Pick the weapon: run `/content slot` and type part of its name, or use the buttons below.");
      if (d.query && matches.length === 0) body.push(`No weapon matches "${escapeText(d.query)}". Search again, or use it as typed.`);
    }
  }
  embed.description = body.join("\n");
  if (shown && !done) embed.thumbnail = { url: weaponIconUrl(shown, 128) };

  const rows: unknown[] = [];
  if (d.counts === null) {
    rows.push({ type: 1, components: [btn("Set roles", `gs:roles:${id}`, { style: 1 }), btn("Cancel", `gs:cancel:${id}`)] });
  } else if (done) {
    rows.push({
      type: 1,
      components: [
        btn("Continue to form", `gs:done:${id}`, { style: 3 }),
        btn("Back", `gs:back:${id}`),
        btn("Change roles", `gs:roles:${id}`),
        btn("Cancel", `gs:cancel:${id}`),
      ],
    });
  } else {
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
        btn("Back", `gs:back:${id}`, { disabled: first }),
        btn("Cancel", `gs:cancel:${id}`),
      ],
    });
    const second = [btn("Change roles", `gs:roles:${id}`)];
    if (d.query) second.unshift(btn(`Use "${d.query}" as typed`.slice(0, 80), `gs:typed:${id}`));
    rows.push({ type: 1, components: second });
  }
  return { content: "", embeds: [embed], components: rows, allowed_mentions: { parse: [] as [] } };
}
