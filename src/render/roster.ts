import type { RosterSlot, RosterView } from "../domain/types.ts";
import { formatTier } from "../domain/parse.ts";
import { VOTE_CUTOFF_MS } from "../domain/vote.ts";
import { DEFAULT_KIND, kindDef } from "../domain/kinds.ts";
import { dutyDef } from "../domain/duties.ts";
import { CANCELLED_TAG, RULE, SCROLL, TITLE_MARK, VOTE_ICON, WORDS, embedColor, fillBar, roleIcon, statusBanner } from "./theme.ts";
import { weaponEmojiByName, weaponEmojiTag } from "./weaponIcon.ts";
import { EN, FIG, padTo, textWidth, widest } from "./align.ts";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TEXT_LIMIT = 4000; // Discord: the text of a V2 message
const TITLE_LIMIT = 200;

export function formatUtc(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export function escapeText(s: string): string {
  return s
    .replace(/[\\*_~`|>#[\]]/g, "\\$&")
    .replace(/@/g, "@\u200B")
    .replace(/</g, "<\u200B");
}

function voteButtons(view: RosterView) {
  const disabled = view.voteClosed || view.status === "cancelled" || view.status === "done";
  return [
    { type: 2, style: 1, label: `Split (${view.votes.split})`, custom_id: `vote:${view.id}:split`, disabled },
    { type: 2, style: 3, label: `Regear (${view.votes.regear})`, custom_id: `vote:${view.id}:regear`, disabled },
  ];
}

// The roster is a Components V2 message (ADR 0018): a coloured container with the header and the rows as text,
// a menu of the open positions, and one row of buttons (Leave and the vote). Discord allows no embeds in it.
export const IS_COMPONENTS_V2 = 1 << 15;

export function voteResultText(view: RosterView): string {
  const { split, regear } = view.votes;
  switch (view.voteResult) {
    case "split": return `Split won ${split}-${regear}`;
    case "regear": return `Regear won ${regear}-${split}`;
    case "tie": return `Tie ${split}-${regear}`;
    default: return "no votes";
  }
}

// The line the scheduled job posts when the vote closes.
export function voteLine(view: RosterView): string {
  return `${VOTE_ICON} Loot vote result: ${voteResultText(view)}`;
}

function lootValue(view: RosterView): string {
  if (!view.hasLoot) return "Off";
  if (view.voteClosed) return `On · Result: ${voteResultText(view)}`;
  const closes = Math.floor((view.startsAt.getTime() - VOTE_CUTOFF_MS) / 1000);
  return `On · Split ${view.votes.split} · Regear ${view.votes.regear} · closes <t:${closes}:R>`;
}

// roleIcon Role - WeaponIcon Weapon - Duty (if any) · Sworn: Player (or Open)
// roleIcon Role - WeaponIcon Weapon - Duty (if any) · Sworn: Player (or Open). With `aligned`, the role, weapon and
// duty columns are padded to the widest of their rows so the text sits beneath each other (approximately).
function rowsText(slots: RosterSlot[], withEmoji: boolean, aligned: boolean): string[] {
  const hasDuty = slots.some((s) => dutyDef(s.duty));
  const roleW = aligned ? widest(slots.map((s) => s.role)) : 0;
  const weaponW = aligned ? widest(slots.map((s) => s.weapon)) : 0;
  const dutyW = aligned ? widest(slots.map((s) => (dutyDef(s.duty) ? `${dutyDef(s.duty)!.icon} ${dutyDef(s.duty)!.label}` : ""))) : 0;
  const anyEmoji = withEmoji && slots.some((s) => weaponEmojiTag(s.weapon));
  return slots.map((s) => {
    const emoji = withEmoji ? weaponEmojiTag(s.weapon) : "";
    const duty = dutyDef(s.duty);
    const num = aligned && slots.length >= 10 && s.position < 10 ? `${FIG}${s.position}.` : `${s.position}.`;
    const role = `${escapeText(s.role)}${aligned ? padTo(s.role, roleW) : ""}`;
    // A row without an icon keeps the icon's room, so the weapon names still line up.
    const icon = emoji ? `${emoji} ` : anyEmoji && aligned ? EN.repeat(3) : "";
    const weapon = `${escapeText(s.weapon)}${aligned ? padTo(s.weapon, weaponW) : ""}`;
    const dutyCell = duty ? `${duty.icon} ${duty.label}` : "";
    // A row without a duty keeps the duty column's room (no dangling dash), so the Sworn/Open column still lines up.
    const dutyPart = duty ? ` - ${dutyCell}${aligned ? padTo(dutyCell, dutyW, 0) : ""}` : hasDuty && aligned ? padTo("", dutyW + textWidth(" - "), 0) : "";
    return `${num} ${roleIcon(s.role)} ${role} - ${icon}${weapon}${dutyPart} · ${s.userId ? `${WORDS.sworn}: <@${s.userId}>` : WORDS.open}`;
  });
}

const LABELS = ["Type", "Gear tier", "Loot vote", "UTC", "Your time"];
const labelWidth = widest(LABELS) * 1.06; // bold is a little wider

function headerText(view: RosterView, filled: number, notes: boolean): string {
  const epoch = Math.floor(view.startsAt.getTime() / 1000);
  const typeLabel = view.type === "pvp" ? "PvP" : "PvE";
  const def = kindDef(view.type, view.kind);
  const kind = def && def.id !== DEFAULT_KIND ? `${typeLabel} · ${def.label}` : typeLabel;
  const title = view.status === "cancelled"
    ? `${CANCELLED_TAG} ${escapeText(view.title)}`
    : `${SCROLL} ${TITLE_MARK} ${escapeText(view.title)} ${TITLE_MARK}`;
  // Each label is followed by padding so the values start in the same column (approximately).
  const fact = (icon: string, label: string, value: string) => `${icon} **${label}**${padTo(label, labelWidth, 2)}${value}`;
  const lines = [
    `**${Array.from(title).slice(0, TITLE_LIMIT).join("")}**`,
    fact("⚔️", "Type", `**${kind}**`),
    fact("⚙️", "Gear tier", formatTier(view.tier)),
    fact(VOTE_ICON, "Loot vote", lootValue(view)),
    fact("🕰️", "UTC", formatUtc(view.startsAt)),
    fact("🌍", "Your time", `<t:${epoch}:f> · <t:${epoch}:R>`),
  ];
  const banner = statusBanner(view.status, view.started);
  if (banner) lines.push(banner);
  if (notes && view.notes) lines.push(`📝 **Notes:** ${escapeText(view.notes)}`);
  lines.push(RULE, `**${WORDS.company} (${filled}/${view.slots.length})** ${fillBar(filled, view.slots.length)}`);
  return lines.join("\n");
}

const text = (content: string) => ({ type: 10, content });

export function renderRosterMessage(view: RosterView): {
  flags: number;
  components: unknown[];
  allowed_mentions: { parse: [] };
} {
  const filled = view.slots.filter((s) => s.userId !== null).length;
  const live = view.status === "open" || view.status === "locked";

  // Keep the text under Discord's 4000: drop the weapon icons, then the notes, then cut rows, only if needed.
  let withEmoji = true;
  let aligned = true;
  let notes = true;
  const waitLen = Math.min(600, (view.waitlist ?? []).reduce((n, w) => n + 40 + w.role.length, 30));
  const fits = () => headerText(view, filled, notes).length + waitLen + rowsText(view.slots, withEmoji, aligned).reduce((n, t) => n + t.length + 1, 0) <= TEXT_LIMIT;
  if (!fits()) withEmoji = false;
  if (!fits()) aligned = false;
  if (!fits()) notes = false;

  const waiting = view.waitlist ?? [];
  const waitText = waiting.length
    ? `🕒 **Waitlist (${waiting.length}):** ${waiting.map((w, i) => `${i + 1}. <@${w.userId}> (${escapeText(w.role)})`).join(" · ")}`.slice(0, 600)
    : "";
  const rowTexts = rowsText(view.slots, withEmoji, aligned);
  const rows = view.slots.map((s, n) => ({ s, text: rowTexts[n]! }));
  const budget = TEXT_LIMIT - headerText(view, filled, notes).length - waitText.length - 2;
  let used = 0;
  const kept = rows.filter((r) => (used += r.text.length + 1) <= budget);

  // All rows in one text block. Leave is one shared button (owner decision 2026-10-07): Discord cannot enable a
  // control for some viewers only, so it is enabled while anyone is signed up and only acts for signed-up players.
  const body: unknown[] = [text(headerText(view, filled, notes)), text([...kept.map((r) => r.text), ...(waitText ? [waitText] : [])].join("\n"))];

  const open = view.slots.filter((s) => s.userId === null);
  if (view.status === "open" && !view.started && open.length > 0) {
    body.push({
      type: 1,
      components: [{
        type: 3, custom_id: `join:${view.id}`, placeholder: `Pick an open position (${open.length})`,
        options: open.slice(0, 25).map((s) => ({
          label: Array.from(`${s.position}. ${s.role} - ${s.weapon}${dutyDef(s.duty) ? ` - ${dutyDef(s.duty)!.label}` : ""}`).slice(0, 100).join(""),
          value: s.id,
          emoji: weaponEmojiByName(s.weapon) ?? { name: roleIcon(s.role) },
        })),
      }],
    });
  }
  // A role with no open position can be waited for (FR-007, per role).
  const fullRoles = [...new Set(view.slots.map((s) => s.role))].filter(
    (role) => !view.slots.some((s) => s.role === role && s.userId === null),
  );
  if (view.status === "open" && !view.started && fullRoles.length > 0) {
    body.push({
      type: 1,
      components: [{
        type: 3, custom_id: `wait:${view.id}`, placeholder: "Join the waitlist for a full role",
        options: fullRoles.slice(0, 25).map((role) => ({
          label: Array.from(`${role} (all taken)`).slice(0, 100).join(""), value: role.slice(0, 100), emoji: { name: roleIcon(role) },
          description: `${waiting.filter((w) => w.role.toLowerCase() === role.toLowerCase()).length} waiting`,
        })),
      }],
    });
  }
  const buttons: unknown[] = [
    {
      type: 2, style: 4, label: "Leave", emoji: { name: "🚪" }, custom_id: `leave:${view.id}`,
      disabled: !(live && (filled > 0 || waiting.length > 0)),
    },
  ];
  if (view.hasLoot) buttons.push(...voteButtons(view));
  // The owner pings the signed-up players by private message (checked when pressed; shown to everyone).
  buttons.push({
    type: 2, style: 2, label: "Ping players", emoji: { name: "📣" }, custom_id: `ping:${view.id}`,
    disabled: !(live && filled > 0) || view.pinged === true,
  });
  body.push({ type: 1, components: buttons });

  return {
    flags: IS_COMPONENTS_V2,
    components: [{ type: 17, accent_color: embedColor(view.type, view.status, view.kind), components: body }],
    allowed_mentions: { parse: [] },
  };
}
