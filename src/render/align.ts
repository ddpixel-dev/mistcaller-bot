// Approximate text alignment for Discord (owner decision 2026-10-08). Discord draws text in a font where letters
// have different widths, so exact columns are impossible; this estimates each text's width and pads with EN SPACEs
// (which, unlike ordinary spaces, are not collapsed) so the columns line up closely on most devices.
export const EN = " "; // en space, about half an em
export const FIG = " "; // figure space, about the width of a digit

const NARROW = new Set([..." .,:;!|'`ilIjtfr()[]1"]);
const WIDE = new Set([..."mwMW@"]);

// Width in ems, roughly, of a plain text (no markdown, no mentions).
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0xfe0f || cp === 0x200d || cp === 0x2002 || cp === 0x2007) { w += cp === 0x2002 ? 0.5 : cp === 0x2007 ? 0.55 : 0; continue; }
    if (cp > 0x2000 && /\p{Extended_Pictographic}/u.test(ch)) w += 1.15;
    else if (NARROW.has(ch)) w += 0.3;
    else if (WIDE.has(ch)) w += 0.85;
    else if (/[A-Z]/.test(ch)) w += 0.66;
    else w += 0.55;
  }
  return w;
}

export const widest = (texts: string[]): number => texts.reduce((m, t) => Math.max(m, textWidth(t)), 0);

// Padding that brings `text` up to `target` ems, with at least `min` en spaces so values never touch.
export function padTo(text: string, target: number, min = 1): string {
  const n = Math.round((target - textWidth(text)) / 0.5);
  return EN.repeat(Math.max(min, n));
}
