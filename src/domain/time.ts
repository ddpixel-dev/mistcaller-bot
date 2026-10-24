const pad = (n: number) => String(n).padStart(2, "0");

// A date as the forms write it: `YYYY-MM-DD HH:mm`, in UTC.
export const utcInput = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

// FR-037: the create form starts with the current time plus one hour, so the member only adjusts it.
export const defaultStart = (now: Date): string => utcInput(new Date(now.getTime() + 60 * 60000));

