import type { Stats, Period } from "../db/stats.ts";
import { DEFAULT_KIND, TYPE_LABEL, kindDef } from "../domain/kinds.ts";
import { IS_COMPONENTS_V2 } from "./roster.ts";

// FR-044: the private answer of `/content stats`.
const ACCENT = 0x6f4fb0;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MAX_CATEGORIES = 12;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const textBlock = (content: string) => ({ type: 10, content });

// One number per line, so the figures are easy to scan (owner request 2026-10-15).
const line = (label: string, value: string) => `• ${label}: **${value}**`;
const events = (title: string, p: Period) => [`**${title}**`, line("Created", String(p.created)), line("Finished", String(p.finished)), line("Cancelled", String(p.cancelled))].join("\n");
const players = (title: string, p: Period) => [`**${title}**`, line("Participants", String(p.participants)), line("Sign-ups", String(p.signups))].join("\n");

export function renderStats(s: Stats, stamp: Date): unknown {
  const updated = `-# Generated <t:${Math.floor(stamp.getTime() / 1000)}:R> · cancelled events and players who left a roster are not counted`;
  const head = `# 📊 Statistics\n${updated}`;
  const message = (parts: string[]) => ({
    flags: IS_COMPONENTS_V2,
    components: [{ type: 17, accent_color: ACCENT, components: parts.map(textBlock) }],
    allowed_mentions: { parse: [] as [] },
  });
  if (s.all.created === 0) return message([head, "No events yet. The numbers appear after the first event is created."]);

  const kinds = s.byKind.slice(0, MAX_CATEGORIES).map((k) => {
    const def = kindDef(k.type, k.kind);
    return line(def && def.id !== DEFAULT_KIND ? def.label : `${TYPE_LABEL[k.type]} · Other`, String(k.count));
  });
  if (s.byKind.length > MAX_CATEGORIES) kinds.push(`• …and ${s.byKind.length - MAX_CATEGORIES} more`);
  const parts = [
    head,
    `### 🗓️ Events\n${events("All time", s.all)}\n${events("Last 30 days", s.month)}`,
    `### ⚔️ By type\n${[line("PvP", String(s.byType.pvp)), line("PvE", String(s.byType.pve)), line("PvX", String(s.byType.pvx))].join("\n")}`,
    `### 🏷️ By category\n${kinds.join("\n")}`,
    `### 👥 Players\n${players("All time", s.all)}\n${players("Last 30 days", s.month)}${
      s.fillRate !== null ? `\n**Fill rate**\n${line("Average of finished events", `${s.fillRate}%`)}` : ""}`,
  ];
  if (s.busiestDay || s.busiestHour) {
    const day = s.busiestDay ? line("Day", `${DAYS[s.busiestDay.day]}`) + ` (${plural(s.busiestDay.count, "event")})` : "";
    const hour = s.busiestHour ? line("Hour", `${String(s.busiestHour.hour).padStart(2, "0")}:00 UTC`) + ` (${plural(s.busiestHour.count, "event")})` : "";
    parts.push(`### ⏰ Busiest\n${[day, hour].filter(Boolean).join("\n")}`);
  }
  if (s.topHosts.length) parts.push(`### 🏆 Top hosts\n${s.topHosts.map((h, i) => `${i + 1}. <@${h.userId}> · ${plural(h.count, "event")}`).join("\n")}`);
  if (s.topPlayers.length) parts.push(`### 🌟 Most joined players\n${s.topPlayers.map((p, i) => `${i + 1}. <@${p.userId}> · ${plural(p.count, "event")}`).join("\n")}`);
  return message(parts);
}
