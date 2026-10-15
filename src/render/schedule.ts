import type { ContentType } from "../domain/types.ts";
import { DEFAULT_KIND, TYPE_LABEL, kindDef } from "../domain/kinds.ts";
import { escapeText, IS_COMPONENTS_V2 } from "./roster.ts";

// FR-043: the calendar channel's message(s): the next 7 days, one section per day that has events, with the events
// already running on top. Each event shows its UTC time as a column, its party, the viewer's own time and a link to
// its roster. Days without events are left out.
export type ScheduleEvent = {
  id: string; threadId: string; messageId: string | null; title: string; type: ContentType; kind: string;
  startsAt: Date; status: "open" | "locked"; party: number; total: number;
};

export const EVENTS_PER_MESSAGE = 12;
export const CALENDAR_DAYS = 7;
const TEXT_BUDGET = 3500; // under Discord's 4000 for the whole message
const ACCENT = 0xc9a227;
const TYPE_ICON: Record<ContentType, string> = { pvp: "⚔️", pve: "🐉", pvx: "🌐" };
const DAY = 24 * 3600000;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const midnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

function eventText(e: ScheduleEvent, guildId: string): string {
  const epoch = Math.floor(e.startsAt.getTime() / 1000);
  const def = kindDef(e.type, e.kind);
  const kind = def && def.id !== DEFAULT_KIND ? `${TYPE_LABEL[e.type]} · ${def.label}` : TYPE_LABEL[e.type];
  const link = e.messageId ? `https://discord.com/channels/${guildId}/${e.threadId}/${e.messageId}` : `https://discord.com/channels/${guildId}/${e.threadId}`;
  const title = Array.from(e.title).slice(0, 100).join("");
  return [
    `\`${pad(e.startsAt.getUTCHours())}:${pad(e.startsAt.getUTCMinutes())}\` ${TYPE_ICON[e.type]} **${escapeText(title)}** [Open ↗](${link})`,
    `-# ${kind} · 👥 ${e.party}/${e.total}${e.status === "locked" ? " · 🔒" : ""} · your time <t:${epoch}:t> · <t:${epoch}:R>`,
  ].join("\n");
}

const textBlock = (content: string) => ({ type: 10, content });
const message = (parts: string[]) => ({
  flags: IS_COMPONENTS_V2,
  components: [{ type: 17, accent_color: ACCENT, components: parts.map(textBlock) }],
  allowed_mentions: { parse: [] as [] },
});

type Group = { heading: string; events: ScheduleEvent[] };

// One body per message. `stamp` is the "Updated" time; the refresh compares renders made with the same stamp.
export function renderSchedule(events: ScheduleEvent[], guildId: string, now: Date, stamp: Date): unknown[] {
  const sorted = [...events].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
  const running = sorted.filter((e) => e.startsAt.getTime() <= now.getTime());
  const today = midnight(now);
  const days: Group[] = Array.from({ length: CALENDAR_DAYS }, (_, i) => {
    const d = new Date(today + i * DAY);
    const tag = i === 0 ? " · Today" : i === 1 ? " · Tomorrow" : "";
    return { heading: `### 📆 ${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}${tag}`, events: [] };
  });
  for (const e of sorted) {
    if (e.startsAt.getTime() <= now.getTime()) continue;
    const idx = Math.floor((midnight(e.startsAt) - today) / DAY);
    if (idx >= 0 && idx < CALENDAR_DAYS) days[idx]!.events.push(e);
  }
  const shown = running.length + days.reduce((k, d) => k + d.events.length, 0);
  const updated = `-# Updated <t:${Math.floor(stamp.getTime() / 1000)}:R>`;
  if (shown === 0) {
    return [message([`# 📅 Events Calendar\n${updated}`, "No live or upcoming events. Start one with `/content create` in a channel or post."])];
  }

  // Pack the groups into messages by event count and by text size. A day that continues repeats its heading.
  const groups: Group[] = [...(running.length ? [{ heading: "### 🔴 Live now", events: running }] : []), ...days];
  const pages: string[][] = [[]];
  let count = 0;
  let size = 0;
  const page = () => pages[pages.length - 1]!;
  for (const g of groups) {
    if (g.events.length === 0) continue;
    let heading = g.heading;
    let lines: string[] = [];
    const flush = () => {
      if (lines.length > 0) page().push(`${heading}\n${lines.join("\n\n")}`);
      lines = [];
    };
    for (const e of g.events) {
      const text = eventText(e, guildId);
      if (count >= EVENTS_PER_MESSAGE || size + text.length + heading.length + 4 > TEXT_BUDGET) {
        flush();
        pages.push([]);
        count = 0;
        size = 0;
        heading = `${g.heading} (cont.)`;
      }
      if (lines.length === 0) size += heading.length + 2;
      lines.push(text);
      count++;
      size += text.length + 2;
    }
    flush();
  }
  const total = pages.length;
  return pages.map((parts, i) => {
    const head = i === 0
      ? `# 📅 Events Calendar\n${updated} · ${shown} event${shown === 1 ? "" : "s"} · times in UTC, with yours beside them`
      : `-# Events Calendar, continued (${i + 1}/${total})`;
    return message([head, ...parts]);
  });
}
