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
  } else if (c.type >= 5 && c.type <= 8) {
    // user, role, mentionable and channel pickers: Discord supplies the choices, so there are no options to count
    ids.push(c.custom_id);
    if (!c.custom_id || c.custom_id.length > 100) out.push(`${where}: picker custom_id missing or over 100`);
    const max = c.max_values ?? 1, min = c.min_values ?? 1;
    if (min < 0 || max < 1 || max > 25 || min > max) out.push(`${where}: picker min/max values are not valid`);
    if ((c.default_values ?? []).length > max) out.push(`${where}: more defaults than max_values`);
    if (c.placeholder && Array.from(c.placeholder).length > 150) out.push(`${where}: placeholder over 150`);
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
  } else if (c.type === 14) {
    // A separator: an optional divider line and a small (1) or large (2) gap.
    if (c.spacing !== undefined && c.spacing !== 1 && c.spacing !== 2) out.push(`${where}: separator spacing is 1 or 2`);
  } else if (c.type === 11) {
    // A thumbnail, as a section's accessory: one image by URL.
    if (typeof c.media?.url !== "string" || !/^https:\/\//.test(c.media.url)) out.push(`${where}: a thumbnail needs an https media url`);
  } else if (c.type === 18) {
    // A Label in a form: a title (45), an optional description (100), and one text input or menu.
    if (!c.label || Array.from(String(c.label)).length > 45) out.push(`${where}: label empty or over 45`);
    if (c.description && Array.from(String(c.description)).length > 100) out.push(`${where}: label description over 100`);
    const k = c.component;
    if (!k || ![3, 4, 5, 6, 7, 8].includes(k.type)) out.push(`${where}: a label holds one text input or menu`);
    else walk(k, out, ids, texts, `${where}.in`);
  } else if (c.type === 4) {
    ids.push(c.custom_id);
    if (!c.custom_id || c.custom_id.length > 100) out.push(`${where}: text input custom_id missing or over 100`);
    if (c.style !== 1 && c.style !== 2) out.push(`${where}: text input style must be 1 or 2`);
    const max = c.max_length ?? 4000;
    if (max < 1 || max > 4000) out.push(`${where}: text input max_length not 1 to 4000`);
    if (c.placeholder && Array.from(String(c.placeholder)).length > 100) out.push(`${where}: placeholder over 100`);
    if (c.value !== undefined && Array.from(String(c.value)).length > max) out.push(`${where}: value longer than max_length`);
    if (c.label !== undefined && Array.from(String(c.label)).length > 45) out.push(`${where}: text input label over 45`);
  } else {
    out.push(`${where}: unknown component type ${c.type}`);
  }
}

// A form (modal): a title of 45 at most, 1 to 5 fields, each in a Label or (the older layout) an action row.
export function modalProblems(data: C): string[] {
  const out: string[] = [];
  const ids: string[] = [];
  if (!data.custom_id || String(data.custom_id).length > 100) out.push("form custom_id missing or over 100");
  if (!data.title || Array.from(String(data.title)).length > 45) out.push("form title empty or over 45");
  const comps: C[] = data.components ?? [];
  if (comps.length < 1 || comps.length > 5) out.push(`a form holds 1 to 5 fields (has ${comps.length})`);
  comps.forEach((c, i) => {
    if (c.type !== 18 && c.type !== 1) out.push(`f${i}: a form field is a label or a row`);
    if (c.type === 1 && (c.components?.length !== 1 || c.components[0].type !== 4)) out.push(`f${i}: a row in a form holds one text input`);
    walk(c, out, ids, [], `f${i}`);
  });
  if (new Set(ids).size !== ids.length) out.push("duplicate custom_id in one form");
  return out;
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

// What a reply says, whether a classic message (content) or a Components V2 one (its text blocks).
export const say = (r: { data?: C }): string => String(r.data?.content ?? textOf(r.data ?? {}));
// The rows of buttons and menus of a message, wherever they sit (inside a V2 container or at the top).
export const rowsOf = (body: C): C[] => flatComponents(body).filter((c) => c.type === 1);
// The creation card's draft id, from its Create button (ADR 0032, 0033).
export const cardIdOf = (r: { data: C }): string => String(flatComponents(r.data).find((c) => String(c.custom_id ?? "").startsWith("cc:create:"))!.custom_id).split(":")[2]!;
