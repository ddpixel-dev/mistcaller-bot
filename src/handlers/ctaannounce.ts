import { postName } from "../domain/postname.ts";
import { escapeText, rosterButton, type RosterLink } from "../render/roster.ts";

// The one-line CTA announcement (ADR 0036, update 2026-11-10): the post name and the start, with the Roster link
// button once the roster is posted (FR-063). No mentions are ever parsed.
export function announcementBody(title: string, startsAt: Date, link?: RosterLink): Record<string, unknown> {
  // Only the title is escaped: the separators of the post name are plain text.
  const name = postName(title, startsAt);
  const suffix = postName("", startsAt);
  return {
    content: `📣 **${escapeText(name.slice(0, name.length - suffix.length))}${suffix}** · <t:${Math.floor(startsAt.getTime() / 1000)}:f>`,
    allowed_mentions: { parse: [] },
    ...(link ? { components: rosterButton(link) } : {}),
  };
}
