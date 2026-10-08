import type { RosterSlot, RosterView } from "../domain/types.ts";
import { formatTier } from "../domain/parse.ts";
import { VOTE_CUTOFF_MS } from "../domain/vote.ts";
import { DEFAULT_KIND, kindDef } from "../domain/kinds.ts";
import { dutyDef } from "../domain/duties.ts";
import { CANCELLED_TAG, RULE, SCROLL, TITLE_MARK, VOTE_ICON, WORDS, embedColor, fillBar, roleIcon, statusBanner } from "./theme.ts";
import { weaponEmojiByName, weaponEmojiTag } from "./weaponIcon.ts";

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

// Layout E (owner decision 2026-10-08): the rows are grouped under a heading per role, so there is no role column to
// line up. A row reads `n. WeaponIcon Weapon - DutyIcon Duty · Sworn: Player` (or `Open`); the duty only when set.
// Groups follow the order in which each role first appears; rows keep their position numbers.
type Line = { text: string; heading: boolean };

function rowLines(slots: RosterSlot[], withEmoji: boolean): Line[] {
  const groups = new Map<string, RosterSlot[]>();
  for (const s of slots) {
    const key = s.role.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const lines: Line[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    const taken = group.filter((s) => s.userId !== null).length;
    lines.push({ text: `### ${roleIcon(first.role)} ${escapeText(first.role)} · ${taken}/${group.length}`, heading: true });
    for (const s of group) {
      const emoji = withEmoji ? weaponEmojiTag(s.weapon) : "";
      const duty = dutyDef(s.duty);
      lines.push({
        text: `${s.position}. ${emoji ? `${emoji} ` : ""}${escapeText(s.weapon)}${duty ? ` - ${duty.icon} ${duty.label}` : ""} · ${
          s.userId ? `${WORDS.sworn}: <@${s.userId}>` : WORDS.open
        }`,
        heading: false,
      });
    }
  }
  return lines;
}

// The header labels start their values in one column: each label is followed by this many EN SPACEs. The counts were
// measured on a screenshot of Discord's desktop text (a label's width, plus 6.7 px per en space, plus about 4 px),
// so the columns agree to within a few pixels. Discord's font is proportional, so this cannot be exact.
const EN = "\u2002";
const HEADER_PAD: Record<string, number> = { Type: 6, "Gear tier": 3, "Loot vote": 2, UTC: 7, "Your time": 2 };

function headerText(view: RosterView, filled: number, notes: boolean): string {
  const epoch = Math.floor(view.startsAt.getTime() / 1000);
  const typeLabel = view.type === "pvp" ? "PvP" : "PvE";
  const def = kindDef(view.type, view.kind);
  const kind = def && def.id !== DEFAULT_KIND ? `${typeLabel} · ${def.label}` : typeLabel;
  const title = view.status === "cancelled"
    ? `${CANCELLED_TAG} ${escapeText(view.title)}`
    : `${SCROLL} ${TITLE_MARK} ${escapeText(view.title)} ${TITLE_MARK}`;
  const fact = (icon: string, label: string, value: string) => `${icon} **${label}**${EN.repeat(HEADER_PAD[label] ?? 2)}${value}`;
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
  let notes = true;
  const waitLen = Math.min(600, (view.waitlist ?? []).reduce((n, w) => n + 40 + w.role.length, 30));
  const fits = () => headerText(view, filled, notes).length + waitLen + rowLines(view.slots, withEmoji).reduce((n, l) => n + l.text.length + 1, 0) <= TEXT_LIMIT;
  if (!fits()) withEmoji = false;
  if (!fits()) notes = false;

  const waiting = view.waitlist ?? [];
  const waitText = waiting.length
    ? `🕒 **Waitlist (${waiting.length}):** ${waiting.map((w, i) => `${i + 1}. <@${w.userId}> (${escapeText(w.role)})`).join(" · ")}`.slice(0, 600)
    : "";
  const budget = TEXT_LIMIT - headerText(view, filled, notes).length - waitText.length - 2;
  let used = 0;
  const kept = rowLines(view.slots, withEmoji).filter((l) => (used += l.text.length + 1) <= budget);
  while (kept.length > 0 && kept[kept.length - 1]!.heading) kept.pop(); // never end on a heading with no row

  // All rows in one text block. Leave is one shared button (owner decision 2026-10-07): Discord cannot enable a
  // control for some viewers only, so it is enabled while anyone is signed up and only acts for signed-up players.
  const body: unknown[] = [text(headerText(view, filled, notes)), text([...kept.map((l) => l.text), ...(waitText ? [waitText] : [])].join("\n"))];

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
