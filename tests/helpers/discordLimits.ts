// A checker for Discord's message rules, so a payload Discord would refuse fails a test first.
// (The Healer "✚" button emoji got through because tests checked our structure, not Discord's rules.)
export const IS_COMPONENTS_V2 = 1 << 15;

type C = Record<string, any>;
const EMOJI = /\p{Emoji_Presentation}|️/u;

function count(c: C): number {
  if (c.type === 1 || c.type === 17) return 1 + (c.components ?? []).reduce((n: number, x: C) => n + count(x), 0);
  if (c.type === 9) return 1 + (c.components ?? []).length + (c.accessory ? 1 : 0);
  return 1;
}

function emojiProblem(e: C | undefined, where: string): string[] {
  if (!e) return [];
  if (e.id !== undefined) return /^\d{15,25}$/.test(String(e.id)) && /^[A-Za-z0-9_]{2,32}$/.test(String(e.name ?? "")) ? [] : [`${where}: bad custom emoji`];
  return typeof e.name === "string" && EMOJI.test(e.name) ? [] : [`${where}: "${e.name}" is not a real emoji`];
}

function walk(c: C, out: string[], ids: string[], texts: string[], where: string) {
  if (c.type === 1) {
    const kids = c.components ?? [];
    const selects = kids.filter((k: C) => k.type >= 3 && k.type <= 8).length;
    if (selects > 1 || (selects === 1 && kids.length > 1)) out.push(`${where}: a row holds one menu or up to 5 buttons`);
    if (kids.length > 5) out.push(`${where}: more than 5 components in a row`);
    if (kids.length === 0) out.push(`${where}: empty row`);
    kids.forEach((k: C, i: number) => walk(k, out, ids, texts, `${where}.${i}`));
  } else if (c.type === 2) {
    if (c.custom_id) {
      ids.push(c.custom_id);
      if (c.custom_id.length > 100) out.push(`${where}: custom_id over 100`);
    } else if (c.style !== 5) out.push(`${where}: button without custom_id`);
    if (c.label !== undefined && Array.from(String(c.label)).length > 80) out.push(`${where}: button label over 80`);
    if (c.label === undefined && !c.emoji) out.push(`${where}: button needs a label or an emoji`);
    out.push(...emojiProblem(c.emoji, `${where} button`));
  } else if (c.type === 3) {
    ids.push(c.custom_id);
    if (!c.custom_id || c.custom_id.length > 100) out.push(`${where}: menu custom_id missing or over 100`);
    const opts = c.options ?? [];
    if (opts.length < 1 || opts.length > 25) out.push(`${where}: a menu needs 1 to 25 options (has ${opts.length})`);
    if (c.placeholder && Array.from(c.placeholder).length > 150) out.push(`${where}: placeholder over 150`);
    const max = c.max_values ?? 1, min = c.min_values ?? 1;
    if (min > max || max > opts.length || min > opts.length) out.push(`${where}: min/max values do not fit the options`);
    if (new Set(opts.map((o: C) => o.value)).size !== opts.length) out.push(`${where}: duplicate option values`);
    opts.forEach((o: C, i: number) => {
      if (!o.label || Array.from(String(o.label)).length > 100) out.push(`${where}.o${i}: option label empty or over 100`);
      if (!o.value || String(o.value).length > 100) out.push(`${where}.o${i}: option value empty or over 100`);
      if (o.description && Array.from(String(o.description)).length > 100) out.push(`${where}.o${i}: description over 100`);
      out.push(...emojiProblem(o.emoji, `${where}.o${i} option`));
    });
    if (opts.filter((o: C) => o.default).length > max) out.push(`${where}: more defaults than max_values`);
  } else if (c.type === 9) {
    const kids = c.components ?? [];
    if (kids.length < 1 || kids.length > 3 || kids.some((k: C) => k.type !== 10)) out.push(`${where}: a section holds 1 to 3 text blocks`);
    if (!c.accessory || (c.accessory.type !== 2 && c.accessory.type !== 11)) out.push(`${where}: a section needs a button or thumbnail`);
    kids.forEach((k: C, i: number) => walk(k, out, ids, texts, `${where}.${i}`));
    if (c.accessory) walk(c.accessory, out, ids, texts, `${where}.acc`);
  } else if (c.type === 10) {
    const text = String(c.content ?? "");
    if (text.length === 0) out.push(`${where}: empty text block`);
    if (text.length > 4000) out.push(`${where}: text block over 4000`);
    texts.push(text);
  } else if (c.type === 17) {
    (c.components ?? []).forEach((k: C, i: number) => walk(k, out, ids, texts, `${where}.${i}`));
    if (c.accent_color !== undefined && !(Number.isInteger(c.accent_color) && c.accent_color >= 0 && c.accent_color <= 0xffffff)) {
      out.push(`${where}: bad accent_color`);
    }
  } else {
    out.push(`${where}: unknown component type ${c.type}`);
  }
}

// Returns the problems found (empty when the message is fine). `body` is what we send or answer with.
export function discordProblems(body: C): string[] {
  const out: string[] = [];
  const ids: string[] = [];
  const texts: string[] = [];
  const v2 = ((body.flags ?? 0) & IS_COMPONENTS_V2) !== 0;
  const comps: C[] = body.components ?? [];
  if (v2) {
    if (body.content) out.push("a V2 message cannot have content");
    if ((body.embeds ?? []).length) out.push("a V2 message cannot have embeds");
    const total = comps.reduce((n, c) => n + count(c), 0);
    if (total > 40) out.push(`V2 message has ${total} components (limit 40)`);
  } else {
    if (comps.length > 5) out.push(`more than 5 rows (${comps.length})`);
    if (comps.some((c) => c.type !== 1)) out.push("a classic message holds rows only at the top level");
    const embeds: C[] = body.embeds ?? [];
    if (embeds.length > 10) out.push("more than 10 embeds");
    let chars = 0;
    for (const e of embeds) {
      chars += (e.title?.length ?? 0) + (e.description?.length ?? 0);
      if ((e.title?.length ?? 0) > 256) out.push("embed title over 256");
      if ((e.description?.length ?? 0) > 4096) out.push("embed description over 4096");
    }
    if (chars > 6000) out.push(`embeds hold ${chars} characters (limit 6000)`);
    if ((body.content?.length ?? 0) > 2000) out.push("content over 2000");
  }
  comps.forEach((c, i) => walk(c, out, ids, texts, `c${i}`));
  if (new Set(ids).size !== ids.length) out.push("duplicate custom_id in one message");
  if (v2 && texts.join("").length > 4000) out.push(`V2 text totals ${texts.join("").length} characters (limit 4000)`);
  return out;
}

export const textOf = (body: C): string => {
  const out: string[] = [];
  const visit = (c: C) => {
    if (c.type === 10) out.push(c.content);
    (c.components ?? []).forEach(visit);
    if (c.accessory) visit(c.accessory);
  };
  (body.components ?? []).forEach(visit);
  for (const e of body.embeds ?? []) out.push(e.title ?? "", e.description ?? "");
  return out.join("\n");
};

// The text with the alignment padding (en and figure spaces) taken out, for assertions about the words themselves.
export const plain = (s: string): string => s.replace(/\u2007/g, "").replace(/\u2002+/g, " ").replace(/ {2,}/g, " ");

export const flatComponents = (body: C): C[] => {
  const out: C[] = [];
  const visit = (c: C) => {
    out.push(c);
    (c.components ?? []).forEach(visit);
    if (c.accessory) visit(c.accessory);
  };
  (body.components ?? []).forEach(visit);
  return out;
};
