import type { Result } from "./types.ts";

// The CTA message is a fixed message an admin points the bot at. The bot copies it under every CTA roster (FR-069).
export const CTA_COPY_LIMIT = 2000;

const COMPONENTS_V2 = 1 << 15;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const LINK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(@me|\d+)\/(\d+)\/(\d+)$/;

// Reads a Discord message link and checks that it belongs to this guild.
export function parseMessageLink(text: string, guildId: string): Result<{ channelId: string; messageId: string }> {
  const trimmed = text.trim().replace(/^<(.*)>$/, "$1").trim();
  const m = LINK.exec(trimmed);
  if (!m) return fail("Paste a message link, for example https://discord.com/channels/<server>/<channel>/<message>.");
  if (m[1] === "@me") return fail("That link points to a direct message. Use a link to a message in this server.");
  if (m[1] !== guildId) return fail("That message is in another server. Use a link to a message in this server.");
  return { ok: true, value: { channelId: m[2]!, messageId: m[3]! } };
}

export type SourceMessage = {
  content: string;
  embeds: { type?: string; [k: string]: unknown }[];
  attachments: { url: string }[];
  flags?: number;
};

export type CtaCopy = { content?: string; embeds?: unknown[]; allowed_mentions: { parse: never[] } };

// Cuts to the limit by dropping whole trailing lines. A first line that is too long is sliced with an ellipsis.
function cut(text: string): string {
  const lines = text.split("\n");
  while (lines.length > 1 && lines.join("\n").length > CTA_COPY_LIMIT) lines.pop();
  const out = lines.join("\n");
  return out.length > CTA_COPY_LIMIT ? out.slice(0, CTA_COPY_LIMIT - 1) + "…" : out;
}

// Builds the message to send from the source. Returns null when there is nothing safe to copy.
export function buildCtaCopy(src: SourceMessage): CtaCopy | null {
  const hasText = src.content.trim() !== "";
  // Messages built from components v2 cannot be copied as plain content and embeds.
  if (((src.flags ?? 0) & COMPONENTS_V2) !== 0 && !hasText) return null;
  const embeds = src.embeds.filter((e) => e.type === "rich");
  const parts: string[] = [];
  if (hasText) parts.push(src.content);
  for (const a of src.attachments) parts.push(a.url);
  const content = cut(parts.join("\n"));
  if (content === "" && embeds.length === 0) return null;
  const copy: CtaCopy = { allowed_mentions: { parse: [] } };
  if (content !== "") copy.content = content;
  if (embeds.length > 0) copy.embeds = embeds;
  return copy;
}
