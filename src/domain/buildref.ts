import type { Result } from "./types.ts";

// The build reference of a content (owner decision 2026-10-09, ADR 0025): a Discord link to a channel, thread, forum
// post or message of the same server. It is kept as "<channel>" or "<channel>/<message>" in `build_channel_id`
// (the column name is from 0.18, when only a channel could be linked).
const LINK = /^https?:\/\/(?:(?:www|ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{5,25})\/(\d{5,25})(?:\/(\d{5,25}))?\/?$/i;
const SNOWFLAKE = /^\d{5,25}$/;

export const BUILD_REFERENCE_HELP = "Paste a Discord link (right-click the channel, post or message, then Copy Link) from this server.";

export function parseBuildReference(text: string, guildId: string): Result<string> {
  const trimmed = text.trim().replace(/^<(.*)>$/, "$1");
  const m = LINK.exec(trimmed);
  if (!m) return { ok: false, error: `That is not a link to a channel, post or message of this server. ${BUILD_REFERENCE_HELP}` };
  if (m[1] !== guildId) return { ok: false, error: `That link is from another server. ${BUILD_REFERENCE_HELP}` };
  return { ok: true, value: m[3] ? `${m[2]}/${m[3]}` : m[2]! };
}

// How the roster shows it: a channel, thread or post as a mention (a clickable name), a message as a link.
export function buildRefText(ref: string, guildId: string): string {
  const [channel, message] = ref.split("/");
  return message ? `[Build message](https://discord.com/channels/${guildId}/${channel}/${message})` : `<#${channel}>`;
}

// Button and form ids hold 100 characters at most, so the two ids are packed in base 36: "r<channel>[.<message>]".
const b36 = (n: string) => BigInt(n).toString(36);
export function packRef(ref: string): string {
  return `r${ref.split("/").map(b36).join(".")}`;
}

// null when the text is not a packed reference. A plain channel id is a panel made before 0.20.
export function unpackRef(packed: string): string | null {
  if (SNOWFLAKE.test(packed)) return packed;
  const m = /^r([0-9a-z]{1,16})(?:\.([0-9a-z]{1,16}))?$/.exec(packed);
  if (!m) return null;
  const ids = [m[1]!, m[2]].filter((x): x is string => x !== undefined).map((x) => [...x].reduce((n, ch) => n * 36n + BigInt(parseInt(ch, 36)), 0n).toString());
  return ids.every((id) => SNOWFLAKE.test(id)) ? ids.join("/") : null;
}
