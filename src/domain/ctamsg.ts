import type { Result } from "./types.ts";

// The CTA message is a fixed message an admin points the bot at. The bot forwards it under every CTA roster (FR-069).

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

// The body that forwards the source message into the CTA thread. A forward carries no content and no embeds:
// Discord builds the snapshot itself, so the bot never reads the text. Mentions in a forward never ping.
export function forwardBody(ref: { guildId: string; channelId: string; messageId: string }): {
  message_reference: { type: 1; guild_id: string; channel_id: string; message_id: string; fail_if_not_exists: true };
  allowed_mentions: { parse: never[] };
} {
  return {
    message_reference: { type: 1, guild_id: ref.guildId, channel_id: ref.channelId, message_id: ref.messageId, fail_if_not_exists: true },
    allowed_mentions: { parse: [] },
  };
}
