import type { RosterView } from "../domain/types.ts";
import { formatTier } from "../domain/parse.ts";
import {
  BANNER_URL, ICON_URL, RULE, SCROLL, TITLE_MARK, WORDS, embedColor, fillBar, roleIcon, statusBanner,
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

function voteRow(view: RosterView) {
  const disabled = view.voteClosed || view.status === "cancelled" || view.status === "done";
  return {
    type: 1,
    components: [
      { type: 2, style: 1, label: `Split (${view.votes.split})`, custom_id: `vote:${view.id}:split`, disabled },
      { type: 2, style: 3, label: `Regear (${view.votes.regear})`, custom_id: `vote:${view.id}:regear`, disabled },
    ],
  };
}

export function voteLine(view: RosterView): string {
  const { split, regear } = view.votes;
  if (!view.voteClosed) return `Spoils vote: Split ${split} - Regear ${regear}`;
  switch (view.voteResult) {
    case "split": return `Spoils vote result: Split won ${split}-${regear}`;
    case "regear": return `Spoils vote result: Regear won ${regear}-${split}`;
    case "tie": return `Spoils vote result: Tie ${split}-${regear}`;
    default: return "Spoils vote result: no votes";
  }
}

export function renderRosterMessage(view: RosterView): {
  embeds: Embed[];
  components: unknown[];
  allowed_mentions: { parse: [] };
} {
  const epoch = Math.floor(view.startsAt.getTime() / 1000);
  const filled = view.slots.filter((s) => s.userId !== null).length;
  const kind = view.type === "pvp" ? "PvP" : "PvE";
  const head = [
    `⚔️ **${kind}** · Tier **${formatTier(view.tier)}** · Loot vote: ${view.hasLoot ? "On" : "Off"}`,
    `🕰️ **UTC** · ${formatUtc(view.startsAt)}`,
    `🌍 **Your time** · <t:${epoch}:F> · <t:${epoch}:R>`,
  ];
  const banner = statusBanner(view.status, view.started);
  if (banner) head.push(banner);
  if (view.hasLoot) head.push(voteLine(view));
  const slotLines = view.slots.map(
    (s) =>
      `${roleIcon(s.role)} ${s.position}. ${escapeText(s.role)} - ${escapeText(s.weapon)} · ${
        s.userId ? `${WORDS.sworn}: <@${s.userId}>` : WORDS.open
      }`,
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
    const withNotes = [...head, `📜 ${escapeText(view.notes)}`, ...roster].join("\n");
    if (withNotes.length <= DESC_LIMIT) description = withNotes;
  }
  if (description.length > DESC_LIMIT) description = description.slice(0, DESC_LIMIT);
  const title = `${SCROLL} ${TITLE_MARK} ${escapeText(view.title)} ${TITLE_MARK}`;
  const embed: Embed = {
    title: Array.from(title).slice(0, TITLE_LIMIT).join(""),
    description,
    color: embedColor(view.type, view.status),
    ...(BANNER_URL ? { image: { url: BANNER_URL } } : {}),
    ...(ICON_URL ? { thumbnail: { url: ICON_URL } } : {}),
  };
  return {
    embeds: [embed],
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `signup:${view.id}`,
            placeholder: "Pick a position",
            disabled: view.status !== "open" || view.started,
            options: view.slots.map((s) => ({
              label: Array.from(`${s.position}. ${s.role} - ${s.weapon}`).slice(0, 100).join(""),
              value: s.id,
              description: s.userId ? "Taken" : "Open",
            })),
          },
        ],
      },
      ...(view.hasLoot ? [voteRow(view)] : []),
    ],
    allowed_mentions: { parse: [] },
  };
}
