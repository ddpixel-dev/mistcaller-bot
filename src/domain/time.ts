const pad = (n: number) => String(n).padStart(2, "0");

// A date as the forms write it: `YYYY-MM-DD HH:mm`, in UTC.
export const utcInput = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

// FR-037: the create form starts with the current time plus one hour, so the member only adjusts it.
export const defaultStart = (now: Date): string => utcInput(new Date(now.getTime() + 60 * 60000));

const QUARTER = 15 * 60000;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const START_MINUTES = ["00", "15", "30", "45"] as const;

// The creation card's start (ADR 0033): now plus an hour, rounded up to the next quarter hour, because the card's
// minute menu offers quarters only.
export const cardStart = (now: Date): string => utcInput(new Date(Math.ceil((now.getTime() + 60 * 60000) / QUARTER) * QUARTER));

export function startParts(text: string | null): { day: string; hour: string; minute: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec((text ?? "").trim());
  return m ? { day: m[1]!, hour: m[2]!, minute: m[3]! } : null;
}

// One of the card's start menus changed: the new start, or null for a value no menu offers.
export function withStartPart(text: string | null, part: "day" | "hour" | "minute", value: string, now: Date): string | null {
  const p = startParts(text) ?? startParts(cardStart(now))!;
  if (part === "day") {
    const d = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
    p.day = value;
  } else if (part === "hour") {
    if (!/^\d{2}$/.test(value) || Number(value) > 23) return null;
    p.hour = value;
  } else {
    if (!(START_MINUTES as readonly string[]).includes(value)) return null;
    p.minute = value;
  }
  return `${p.day} ${p.hour}:${p.minute}`;
}

const dayLabel = (d: Date) => `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;

// The Day menu: today and the next 13 days (UTC); a chosen day outside them is kept, first.
export function dayChoices(now: Date, current: string | null): { label: string; value: string }[] {
  const days = Array.from({ length: 14 }, (_, n) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n));
    const prefix = n === 0 ? "Today · " : n === 1 ? "Tomorrow · " : "";
    return { label: `${prefix}${dayLabel(d)}`, value: d.toISOString().slice(0, 10) };
  });
  if (current && !days.some((d) => d.value === current)) {
    const d = new Date(`${current}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) days.unshift({ label: dayLabel(d), value: current });
  }
  return days;
}
