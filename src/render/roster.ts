import type { RosterView } from "../domain/types.ts";
import { formatTier } from "../domain/parse.ts";
import { VOTE_CUTOFF_MS } from "../domain/vote.ts";
import { DEFAULT_KIND, kindDef } from "../domain/kinds.ts";
import { dutyDef } from "../domain/duties.ts";
import {
  BANNER_URL, CANCELLED_TAG, ICON_URL, RULE, SCROLL, TITLE_MARK, VOTE_ICON, WORDS, embedColor, fillBar, roleIcon, statusBanner,
} from "./theme.ts";

export type Embed = {
  title?: string;
  description?: string;
  color?: number;
  image?: { url: string };
  thumbnail?: { url: string };
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DESC_LIMIT = 4096;
const TITLE_LIMIT = 256;

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

export function voteLine(view: RosterView): string {
  return `${VOTE_ICON} ${voteText(view)}`;
}

function voteText(view: RosterView): string {
  const { split, regear } = view.votes;
  if (!view.voteClosed) {
    const closes = Math.floor((view.startsAt.getTime() - VOTE_CUTOFF_MS) / 1000);
    return `Spoils vote: Split ${split} - Regear ${regear} · closes <t:${closes}:R>`;
  }
  switch (view.voteResult) {
    case "split": return `Spoils vote result: Split won ${split}-${regear}`;
    case "regear": return `Spoils vote result: Regear won ${regear}-${split}`;
    case "tie": return `Spoils vote result: Tie ${split}-${regear}`;
    default: return "Spoils vote result: no votes";
  }
}

// Kept so roster messages from release 0.3 to 0.5, which still carry the old menu option, keep working.
export const LEAVE_VALUE = "leave";

// One button per position (owner choice 2026-10-07). A held position is dimmed for everyone, which also
// stops the holder from picking it again. Everything is dimmed once the roll is closed.
function slotRows(view: RosterView) {
  const closed = view.status !== "open" || view.started;
  const buttons = view.slots.map((s) => ({
    type: 2,
    style: 2,
    label: Array.from(`${s.position}. ${s.role} - ${s.weapon}`).slice(0, 80).join(""),
    emoji: { name: roleIcon(s.role) },
    custom_id: `pick:${view.id}:${s.id}`,
    disabled: closed || s.userId !== null,
  }));
  const rows: unknown[] = [];
  for (let at = 0; at < buttons.length; at += 5) rows.push({ type: 1, components: buttons.slice(at, at + 5) });
  return rows;
}

// Leave is shared by everyone, so it is dimmed while nobody is signed up and enabled once anyone is.
// Pressing it without a signup only tells that person so. Leaving stays possible after the start.
// With a loot vote, its two buttons share this last row, so 20 positions plus this row fit five rows.
function bottomRow(view: RosterView, filled: number) {
  const live = view.status === "open" || view.status === "locked";
  return {
    type: 1,
    components: [
      {
        type: 2, style: 4, label: "Leave", emoji: { name: "🚪" }, custom_id: `leave:${view.id}`,
        disabled: !(live && filled > 0),
      },
      ...(view.hasLoot ? voteButtons(view) : []),
    ],
  };
}

export function renderRosterMessage(view: RosterView): {
  embeds: Embed[];
  components: unknown[];
  allowed_mentions: { parse: [] };
} {
  const epoch = Math.floor(view.startsAt.getTime() / 1000);
  const filled = view.slots.filter((s) => s.userId !== null).length;
  const typeLabel = view.type === "pvp" ? "PvP" : "PvE";
  const def = kindDef(view.type, view.kind);
  const kind = def && def.id !== DEFAULT_KIND ? `${typeLabel} · ${def.label}` : typeLabel;
  const head = [
    `⚔️ **${kind}** · Tier **${formatTier(view.tier)}** · Loot vote: ${view.hasLoot ? "On" : "Off"}`,
    `🕰️ **UTC** · ${formatUtc(view.startsAt)}`,
    `🌍 **Your time** · <t:${epoch}:f> · <t:${epoch}:R>`,
  ];
  const banner = statusBanner(view.status, view.started);
  if (banner) head.push(banner);
  if (view.hasLoot) head.push(voteLine(view));
  const slotLines = view.slots.map(
    (s) =>
      `${roleIcon(s.role)} ${s.position}. ${escapeText(s.role)} - ${escapeText(s.weapon)}${
        dutyDef(s.duty) ? ` · ${dutyDef(s.duty)!.icon} ${dutyDef(s.duty)!.label}` : ""
      } · ${s.userId ? `${WORDS.sworn}: <@${s.userId}>` : WORDS.open}`,
  );
  const roster = [
    RULE,
    `**${WORDS.company} (${filled}/${view.slots.length})** ${fillBar(filled, view.slots.length)}`,
    ...slotLines,
    RULE,
  ];
  const base = [...head, ...roster].join("\n");
  let description = base;
  if (view.notes) {
    const withNotes = [...head, `📝 **Notes:** ${escapeText(view.notes)}`, ...roster].join("\n");
    if (withNotes.length <= DESC_LIMIT) description = withNotes;
  }
  if (description.length > DESC_LIMIT) description = description.slice(0, DESC_LIMIT);
  const marked = `${SCROLL} ${TITLE_MARK} ${escapeText(view.title)} ${TITLE_MARK}`;
  const title = view.status === "cancelled" ? `${CANCELLED_TAG} ${escapeText(view.title)}` : marked;
  const embed: Embed = {
    title: Array.from(title).slice(0, TITLE_LIMIT).join(""),
    description,
    color: embedColor(view.type, view.status, view.kind),
    ...(BANNER_URL ? { image: { url: BANNER_URL } } : {}),
    ...(ICON_URL ? { thumbnail: { url: ICON_URL } } : {}),
  };
  return {
    embeds: [embed],
    components: [
      ...slotRows(view),
      bottomRow(view, filled),
    ],
    allowed_mentions: { parse: [] },
  };
}
