import { IS_COMPONENTS_V2 } from "./roster.ts";
import { COLORS, RULE } from "./theme.ts";

// A changelog message looks like the roster post (owner request 2026-11-06): a coloured card (a Components V2 container) with the
// title, a rule line and the text. A V2 message has no `content`, so everything sits in the card.
export function changelogMessage(part: string, first: boolean) {
  const lines = part.split("\n");
  const isTitle = first && /^#{1,3}\s+\S/.test(lines[0] ?? "");
  const text = isTitle ? [lines[0], RULE, ...lines.slice(1).filter((l, i) => !(i === 0 && l.trim() === ""))].join("\n") : part;
  return {
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] },
    components: [{ type: 17, accent_color: COLORS.changelog, components: [{ type: 10, content: text }] }],
  };
}
