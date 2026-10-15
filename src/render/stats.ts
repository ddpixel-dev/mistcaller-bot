import type { Stats, Period } from "../db/stats.ts";
import { DEFAULT_KIND, TYPE_LABEL, kindDef } from "../domain/kinds.ts";
import { IS_COMPONENTS_V2 } from "./roster.ts";

// FR-044: the statistics channel's message.
const ACCENT = 0x6f4fb0;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MAX_CATEGORIES = 12;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const textBlock = (content: string) => ({ type: 10, content });

const events = (label: string, p: Period) => `**${label}** · ${p.created} created · ${p.finished} finished · ${p.cancelled} cancelled`;
const players = (label: string, p: Period) => `**${label}** · ${plural(p.participants, "participant")} · ${plural(p.signups, "sign-up")}`;

export function renderStats(s: Stats, stamp: Date): unknown {
  const updated = `-# Updated <t:${Math.floor(stamp.getTime() / 1000)}:R> · cancelled events and players who left a roster are not counted`;
  const head = `# 📊 Statistics\n${updated}`;
  const message = (parts: string[]) => ({
    flags: IS_COMPONENTS_V2,
    components: [{ type: 17, accent_color: ACCENT, components: parts.map(textBlock) }],
    allowed_mentions: { parse: [] as [] },
  });
  if (s.all.created === 0) return message([head, "No events yet. The numbers appear after the first event is created."]);

  const kinds = s.byKind.slice(0, MAX_CATEGORIES).map((k) => {
    const def = kindDef(k.type, k.kind);
    const name = def && def.id !== DEFAULT_KIND ? def.label : `${TYPE_LABEL[k.type]} · Other`;
    return `${name} **${k.count}**`;
  });
  const more = s.byKind.length > MAX_CATEGORIES ? ` · …and ${s.byKind.length - MAX_CATEGORIES} more` : "";
  const parts = [
    head,
    `### 🗓️ Events\n${events("All time", s.all)}\n${events("Last 30 days", s.month)}`,
    `### ⚔️ By type\nPvP **${s.byType.pvp}** · PvE **${s.byType.pve}** · PvX **${s.byType.pvx}**`,
    `### 🏷️ By category\n${kinds.join(" · ")}${more}`,
    `### 👥 Players\n${players("All time", s.all)}\n${players("Last 30 days", s.month)}${s.fillRate !== null ? `\nAverage fill rate of finished events: **${s.fillRate}%**` : ""}`,
  ];
  if (s.busiestDay || s.busiestHour) {
    const day = s.busiestDay ? `**${DAYS[s.busiestDay.day]}** (${plural(s.busiestDay.count, "event")})` : "";
    const hour = s.busiestHour ? `**${String(s.busiestHour.hour).padStart(2, "0")}:00 UTC** (${plural(s.busiestHour.count, "event")})` : "";
    parts.push(`### ⏰ Busiest\n${[day && `Day ${day}`, hour && `Hour ${hour}`].filter(Boolean).join(" · ")}`);
  }
  if (s.topHosts.length) parts.push(`### 🏆 Top hosts\n${s.topHosts.map((h, i) => `${i + 1}. <@${h.userId}> · ${plural(h.count, "event")}`).join("\n")}`);
  if (s.topPlayers.length) parts.push(`### 🌟 Most joined players\n${s.topPlayers.map((p, i) => `${i + 1}. <@${p.userId}> · ${plural(p.count, "event")}`).join("\n")}`);
  return message(parts);
}
