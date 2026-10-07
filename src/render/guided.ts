import type { StoredDraft } from "../db/draft.ts";
import { WEAPONS } from "../data/weapons.ts";
import { GUIDED_ROLES, canSave, isComplete } from "../domain/guided.ts";
import { DUTIES, dutyDef } from "../domain/duties.ts";
import { SLOT_LABEL, searchWeapons, weaponIconUrl, type Weapon } from "../domain/weapons.ts";
import { escapeText } from "./roster.ts";

const btn = (label: string, id: string, extra: Record<string, unknown> = {}) => ({
  type: 2, style: 2, label, custom_id: id, ...extra,
});

export const TYPED_WEAPON = "typed";

// The weapon list: only the matches of the search (and the weapon already chosen). Nothing is listed before a search.
export function weaponChoices(d: StoredDraft): Weapon[] {
  const list = d.query ? searchWeapons(WEAPONS, d.query, 25) : [];
  const known = d.weapon ? WEAPONS.find((w) => w.name === d.weapon) : undefined;
  if (known && !list.some((w) => w.name === known.name)) return [known, ...list.slice(0, 24)];
  return list;
}

const slotLine = (s: { role: string; weapon: string; duty?: string | null }, n: number) =>
  `${n}. ${escapeText(s.role)} - ${escapeText(s.weapon)}${dutyDef(s.duty) ? ` · ${dutyDef(s.duty)!.icon} ${dutyDef(s.duty)!.label}` : ""}`;

// One screen of the guided steps, rebuilt from the stored draft after every click.
export function renderGuidedStep(d: StoredDraft) {
  const id = d.id;
  const count = d.count ?? 0;
  const done = isComplete(d);
  const embed: Record<string, unknown> = { title: "Guided slots" };
  const body: string[] = [];
  if (d.count === null) {
    body.push("How many players are needed? Press **Set number** and type a number from 1 to 20.");
  } else {
    const dots = Array.from({ length: count }, (_, i) => (i < d.slots.length && i !== d.step ? "●" : i === d.step ? "◉" : "○")).join("");
    body.push(done ? `All ${count} slots are chosen.` : `**Slot ${d.step + 1} of ${count}**`, dots);
    const lines = d.slots.slice(0, count).map((s, i) => slotLine(s, i + 1));
    if (lines.length) body.push("", ...lines);
    if (!done) {
      const here = [d.role, d.weapon, dutyDef(d.duty)?.label].filter(Boolean).map((x) => escapeText(String(x)));
      body.push("", `This slot: ${here.length ? here.join(" · ") : "nothing chosen yet"}`);
      if (d.query) body.push(`Weapon search: "${escapeText(d.query)}"${weaponChoices(d).length === 0 ? " (no match)" : ""}`);
    }
  }
  embed.description = body.join("\n");
  const shown = d.weapon ? WEAPONS.find((w) => w.name === d.weapon) : undefined;
  if (shown && !done) embed.thumbnail = { url: weaponIconUrl(shown, 128) };

  const rows: unknown[] = [];
  if (d.count === null) {
    rows.push({ type: 1, components: [btn("Set number", `gs:count:${id}`, { style: 1 }), btn("Back", `gs:back:${id}`), btn("Cancel", `gs:cancel:${id}`)] });
  } else if (done) {
    rows.push({
      type: 1,
      components: [
        btn("Continue to form", `gs:done:${id}`, { style: 3 }),
        btn("Back", `gs:back:${id}`),
        btn("Change number", `gs:count:${id}`),
        btn("Cancel", `gs:cancel:${id}`),
      ],
    });
  } else {
    const choices = weaponChoices(d);
    const weaponOptions = choices.map((w) => ({
      label: `${w.name} (${SLOT_LABEL[w.slot]})`.slice(0, 100), value: w.base, default: w.name === d.weapon,
    }));
    if (d.weapon && !WEAPONS.some((w) => w.name === d.weapon)) {
      weaponOptions.unshift({ label: d.weapon.slice(0, 100), value: TYPED_WEAPON, default: true });
      weaponOptions.splice(25);
    }
    rows.push({
      type: 1,
      components: [{
        type: 3, custom_id: `gs:role:${id}`, placeholder: "Role (pick one)",
        options: GUIDED_ROLES.map((r) => ({ label: r, value: r, default: r === d.role })),
      }],
    });
    rows.push({
      type: 1,
      components: [{
        type: 3, custom_id: `gs:weapon:${id}`,
        placeholder: weaponOptions.length ? "Weapon (pick one)" : d.query ? "Weapon (no match, search again)" : "Weapon (press Search weapon first)",
        disabled: weaponOptions.length === 0,
        options: weaponOptions.length ? weaponOptions : [{ label: d.query ? "No match" : "Search a weapon first", value: TYPED_WEAPON }],
      }],
    });
    rows.push({
      type: 1,
      components: [{
        // Optional: with min_values 0 the member can deselect the duty, so no "None" entry is needed.
        type: 3, custom_id: `gs:duty:${id}`, placeholder: "Duty (optional)", min_values: 0, max_values: 1,
        options: DUTIES.map((x) => ({ label: x.label, value: x.id, default: x.id === d.duty })),
      }],
    });
    const ready = canSave(d);
    rows.push({
      type: 1,
      components: [
        btn(d.step === count - 1 ? "Finish" : "Next", `gs:next:${id}`, { style: 3, disabled: !ready }),
        btn("Back", `gs:back:${id}`),
        btn("Same as previous", `gs:same:${id}`, { disabled: d.step === 0 }),
        btn("Fill the rest", `gs:rest:${id}`, { disabled: !ready }),
        btn("Cancel", `gs:cancel:${id}`),
      ],
    });
    const tools = [btn("Search weapon", `gs:search:${id}`, { style: 1 })];
    if (d.query) tools.push(btn("Clear search", `gs:clear:${id}`));
    tools.push(btn("Change number", `gs:count:${id}`));
    rows.push({ type: 1, components: tools });
  }
  return { content: "", embeds: [embed], components: rows, allowed_mentions: { parse: [] as [] } };
}
