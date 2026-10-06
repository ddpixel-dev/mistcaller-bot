import type { RosterView } from "../domain/types.ts";
import { formatTier } from "../domain/parse.ts";

export type Embed = { title?: string; description?: string; color?: number };

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
  return s.replace(/[\\*_~`|>#]/g, "\\$&").replace(/@/g, "@\u200B");
}

export function renderRosterMessage(view: RosterView): {
  embeds: Embed[];
  components: unknown[];
  allowed_mentions: { parse: [] };
} {
  const epoch = Math.floor(view.startsAt.getTime() / 1000);
  const filled = view.slots.filter((s) => s.userId !== null).length;
  const head = [
    `${formatUtc(view.startsAt)} (<t:${epoch}:F>, <t:${epoch}:R>)`,
    `Tier: ${formatTier(view.tier)} · ${view.type === "pvp" ? "PvP" : "PvE"} · Loot: ${view.hasLoot ? "Yes" : "No"}`,
  ];
  const slotLines = view.slots.map(
    (s) => `${s.position}. ${escapeText(s.role)} - ${escapeText(s.weapon)} · ${s.userId ? `<@${s.userId}>` : "open"}`,
  );
  const roster = ["", `**Roster (${filled}/${view.slots.length})**`, ...slotLines];
  const base = [...head, ...roster].join("\n");
  let description = base;
  if (view.notes) {
    const withNotes = [...head, escapeText(view.notes), ...roster].join("\n");
    if (withNotes.length <= DESC_LIMIT) description = withNotes;
  }
  if (description.length > DESC_LIMIT) description = description.slice(0, DESC_LIMIT);
  return {
    embeds: [{ title: escapeText(view.title).slice(0, TITLE_LIMIT), description }],
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `signup:${view.id}`,
            placeholder: "Pick a position",
            disabled: view.status !== "open",
            options: view.slots.map((s) => ({
              label: `${s.position}. ${s.role} - ${s.weapon}`.slice(0, 100),
              value: s.id,
              description: s.userId ? "Taken" : "Open",
            })),
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            label: "Leave",
            custom_id: `leave:${view.id}`,
            disabled: view.status === "cancelled" || view.status === "done",
          },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
