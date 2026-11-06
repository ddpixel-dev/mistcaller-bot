// FR-061: release changelogs are plain markdown files in changelog/, posted to each server's changelog channel.
export const MESSAGE_LIMIT = 2000;

// Only a plain version (0.29.0 or v0.29.0) names a file, so a script argument can never reach another path.
export function changelogFileName(version: string): string {
  const m = /^v?(\d+\.\d+\.\d+)$/.exec(version.trim());
  if (!m) throw new Error(`"${version}" is not a version like 0.29.0`);
  return `changelog/${m[1]}.md`;
}

// Cuts at the largest natural break that fits: a blank line, then a line break, then anywhere. Joining the parts with the
// break that was cut gives the original text back (apart from the outer whitespace).
export function splitChangelog(markdown: string, limit = MESSAGE_LIMIT): string[] {
  const text = markdown.trim();
  if (!text) return [];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit + 2);
    let cut = window.lastIndexOf("\n\n");
    let skip = 2;
    if (cut <= 0 || cut > limit) { cut = rest.slice(0, limit + 1).lastIndexOf("\n"); skip = 1; }
    if (cut <= 0) { cut = limit; skip = 0; }
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut + skip);
  }
  parts.push(rest);
  return parts;
}

// A forum post needs a title (100 characters at most): the changelog's first heading, without markdown.
export function changelogTitle(markdown: string, version: string): string {
  const heading = markdown.split("\n").find((l) => /^#{1,3}\s+\S/.test(l));
  const text = heading ? heading.replace(/^#{1,3}\s+/, "").replace(/[*_`~]/g, "").trim() : `What's new in ${version}`;
  return Array.from(text).slice(0, 100).join("");
}

export type ChannelInfo = { type: number; flags?: number; available_tags?: { id: string }[] };
export type ChangelogPlan =
  | { kind: "messages"; messages: string[] }
  | { kind: "forum"; name: string; first: string; replies: string[]; tags: string[] };

const REQUIRE_TAG = 1 << 4;

// Where and how a changelog is posted (owner request 2026-11-06): a text or announcement channel gets one message after
// another; a forum gets one post per release (the first part), with the rest as replies in it. A forum that requires a
// tag gets its first tag, because the bot cannot ask which one.
export function planChangelogPost(channel: ChannelInfo, parts: string[], title: string): ChangelogPlan {
  if (channel.type === 0 || channel.type === 5) return { kind: "messages", messages: parts };
  if (channel.type !== 15) throw new Error("that channel cannot take a changelog (use a text, announcement or forum channel)");
  const required = ((channel.flags ?? 0) & REQUIRE_TAG) !== 0;
  const tags = required ? (channel.available_tags ?? []).slice(0, 1).map((t) => t.id) : [];
  if (required && tags.length === 0) throw new Error("the forum requires a tag but has none");
  return { kind: "forum", name: title, first: parts[0]!, replies: parts.slice(1), tags };
}
