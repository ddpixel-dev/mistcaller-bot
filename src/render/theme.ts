// Medieval Banner theme (ADR 0008, FR-022). Colors, marks and words live here so the
// look can change without touching the signup rules.
import type { ContentStatus, ContentType } from "../domain/types.ts";
import { kindDef } from "../domain/kinds.ts";

export const COLORS = {
  pvp: 0x2b4db0, // royal blue
  pve: 0xc9a227, // gold
  pvx: 0x6f4fb0, // purple: both
  cancelled: 0x6b6b6b,
  done: 0x4a4a4a,
} as const;

// The owner supplies the bot icon and banner art. Set these URLs when the files are hosted.
export const BANNER_URL: string | null = null;
export const ICON_URL: string | null = null;

export const WORDS = {
  company: "The Company",
  sworn: "Sworn",
  open: "Open",
  choice: "Player's choice",
  spoils: "Spoils",
} as const;

export const RULE = "═══════════════════════";
export const TITLE_MARK = "⚜";
export const SCROLL = "📜";
export const VOTE_ICON = "💰";
export const CANCELLED_TAG = "✖ CANCELLED —";
const BAR_CELLS = 10;

export function embedColor(type: ContentType, status: ContentStatus, kind?: string): number {
  if (status === "cancelled") return COLORS.cancelled;
  if (status === "done") return COLORS.done;
  return (kind ? kindDef(type, kind)?.color : undefined) ?? COLORS[type];
}

export function fillBar(filled: number, total: number): string {
  if (total <= 0) return "▱".repeat(BAR_CELLS);
  const on = Math.min(BAR_CELLS, Math.round((filled / total) * BAR_CELLS));
  return "▰".repeat(on) + "▱".repeat(BAR_CELLS - on);
}

const ROLE_ICONS: [RegExp, string][] = [
  [/tank/i, "🛡️"],
  [/support/i, "🤝"],
  [/heal|cleric|holy/i, "💚"],
  [/scout|ranged|archer|bow/i, "🏹"],
  [/call|shot/i, "📯"],
  [/mage|arcane|fire|frost|curse|dps|damage|assassin|dagger|melee/i, "⚔️"],
];

export function roleIcon(role: string): string {
  return ROLE_ICONS.find(([re]) => re.test(role))?.[1] ?? "🔹";
}

export function statusBanner(status: ContentStatus, started: boolean): string | null {
  if (status === "cancelled") return "✖ **Cancelled.** This content will not take place.";
  if (status === "done") return "🏁 **Concluded.**";
  if (status === "locked" || started) return "🔒 **The roll is closed.**";
  return null;
}
