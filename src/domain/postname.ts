const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LIMIT = 100; // Discord: the name of a post

// The name of a post the bot makes (owner request 2026-11-08): `Title | 12 Nov | 20:00 UTC`. Only the title is cut, so
// the date and time always fit. The date and time are read in UTC.
export function postName(title: string, startsAt: Date): string {
  const hh = String(startsAt.getUTCHours()).padStart(2, "0");
  const mm = String(startsAt.getUTCMinutes()).padStart(2, "0");
  const suffix = ` | ${startsAt.getUTCDate()} ${MONTHS[startsAt.getUTCMonth()]} | ${hh}:${mm} UTC`;
  return Array.from(title).slice(0, LIMIT - Array.from(suffix).length).join("") + suffix;
}
