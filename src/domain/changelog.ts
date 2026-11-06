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
