import type { RosterSlot, RosterView } from "../domain/types.ts";
import { VOTE_CUTOFF_MS } from "../domain/vote.ts";
import { DEFAULT_KIND, TYPE_LABEL, kindDef } from "../domain/kinds.ts";
import { dutyDef } from "../domain/duties.ts";
import { CANCELLED_TAG, RULE, SCROLL, TITLE_MARK, VOTE_ICON, WORDS, embedColor, fillBar, roleIcon, statusBanner } from "./theme.ts";
import { weaponEmojiByName, weaponEmojiTag } from "./weaponIcon.ts";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TEXT_LIMIT = 4000; // Discord: the text of a V2 message
const TITLE_LIMIT = 200;

export function formatUtc(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export function escapeText(s: string): string {
  return s
    .replace(/[\\*_~`|>#[\]]/g, "\\$&")
    .replace(/@/g, "@\u200B")
    .replace(/</g, "<\u200B");
}

function voteButtons(view: RosterView) {
  const disabled = view.voteClosed || view.status === "cancelled" || view.status === "done";
  return [
    { type: 2, style: 1, label: `Split (${view.votes.split})`, custom_id: `vote:${view.id}:split`, disabled },
    { type: 2, style: 3, label: `Regear (${view.votes.regear})`, custom_id: `vote:${view.id}:regear`, disabled },
  ];
}

// The roster is a Components V2 message (ADR 0018): a coloured container with the header and the rows as text,
// a menu of the open positions, and one row of buttons (Leave and the vote). Discord allows no embeds in it.
export const IS_COMPONENTS_V2 = 1 << 15;

// Values of the join and waitlist menus for Fill (FR-032). `~` cannot start a slot id, and no role is typed that way.
export const FILL_VALUE = "fill";
export const WAIT_FILL_VALUE = "~fill";

export function voteResultText(view: RosterView): string {
  const { split, regear } = view.votes;
  switch (view.voteResult) {
    case "split": return `Split won ${split}-${regear}`;
    case "regear": return `Regear won ${regear}-${split}`;
    case "tie": return `Tie ${split}-${regear}`;
    default: return "no votes";
  }
}

// The line the scheduled job posts when the vote closes.
export function voteLine(view: RosterView): string {
  return `${VOTE_ICON} Loot vote result: ${voteResultText(view)}`;
}

function lootValue(view: RosterView): string {
  if (!view.hasLoot) return "Off";
  if (view.voteClosed) return `On · Result: ${voteResultText(view)}`;
  const closes = Math.floor((view.startsAt.getTime() - VOTE_CUTOFF_MS) / 1000);
  return `On · Split ${view.votes.split} · Regear ${view.votes.regear} · closes <t:${closes}:R>`;
}

// Layout E (owner decision 2026-10-08): the rows are grouped under a heading per role, so there is no role column to
// line up. A row reads `n. WeaponIcon Weapon - DutyIcon Duty · Sworn: Player` (or `Open`); the duty only when set.
// Groups follow the order in which each role first appears; rows keep their position numbers.
type Line = { text: string; heading: boolean };

// A small gap between blocks of lines (owner decision 2026-10-08, level A): a subtext line holding only an invisible
// character, about three-quarters of a normal line. Dropped first when a very full roster needs the room.
export const SPACER = "-# \u200B";

function rowLines(slots: RosterSlot[], withEmoji: boolean, spaced: boolean): Line[] {
  const groups = new Map<string, RosterSlot[]>();
  for (const s of slots) {
    const key = s.role.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const lines: Line[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    const taken = group.filter((s) => s.userId !== null).length;
    // The gap belongs to the heading, so a cut never leaves a gap or a heading on its own.
    const gap = spaced && lines.length > 0 ? `${SPACER}\n` : "";
    lines.push({ text: `${gap}### ${roleIcon(first.role)} ${escapeText(first.role)} · ${taken}/${group.length}`, heading: true });
    for (const s of group) {
      // A role-only slot shows the holder's own weapon once chosen, and "Player's choice" until then (FR-030).
      const weaponName = s.weapon || s.chosenWeapon || "";
      const emoji = withEmoji && weaponName ? weaponEmojiTag(weaponName) : "";
      const duty = dutyDef(s.duty);
      lines.push({
        text: `${s.position}. ${emoji ? `${emoji} ` : ""}${weaponName ? escapeText(weaponName) : WORDS.choice}${duty ? ` - ${duty.icon} ${duty.label}` : ""} · ${
          s.userId ? `${WORDS.sworn}: <@${s.userId}>` : WORDS.open
        }`,
        heading: false,
      });
    }
  }
  return lines;
}

// The header labels start their values in one column: each label is followed by this many EN SPACEs. The counts were
// measured on a screenshot of Discord's desktop text (a label's width, plus 6.7 px per en space, plus about 4 px),
// so the columns agree to within a few pixels. Discord's font is proportional, so this cannot be exact.
const EN = "\u2002";
const HEADER_PAD: Record<string, number> = { Type: 6, "Gear tier": 3, Build: 6, "Loot vote": 2, UTC: 7, "Your time": 2 };

function headerText(view: RosterView, filled: number, notes: boolean, spaced: boolean): string {
  const epoch = Math.floor(view.startsAt.getTime() / 1000);
  const typeLabel = TYPE_LABEL[view.type];
  const def = kindDef(view.type, view.kind);
  const kind = def && def.id !== DEFAULT_KIND ? `${typeLabel} · ${def.label}` : typeLabel;
  const title = view.status === "cancelled"
    ? `${CANCELLED_TAG} ${escapeText(view.title)}`
    : `${SCROLL} ${TITLE_MARK} ${escapeText(view.title)} ${TITLE_MARK}`;
  const fact = (icon: string, label: string, value: string) => `${icon} **${label}**${EN.repeat(HEADER_PAD[label] ?? 2)}${value}`;
  const gap = spaced ? [SPACER] : [];
  const lines = [
    // A level-1 heading: Discord draws it at about 24 px, the largest text a message can have (owner request 2026-10-08).
    `# ${Array.from(title).slice(0, TITLE_LIMIT).join("")}`,
    ...gap,
    fact("⚔️", "Type", `**${kind}**`),
    fact("⚙️", "Gear tier", view.tier === "" ? "Any" : escapeText(view.tier)),
    ...(view.buildChannelId ? [fact("🧰", "Build", `<#${view.buildChannelId}>`)] : []),
    fact(VOTE_ICON, "Loot vote", lootValue(view)),
    fact("🕰️", "UTC", formatUtc(view.startsAt)),
    fact("🌍", "Your time", `<t:${epoch}:f> · <t:${epoch}:R>`),
    ...gap,
  ];
  const banner = statusBanner(view.status, view.started);
  if (banner) lines.push(banner);
  if (notes && view.notes) lines.push(`📝 **Notes:** ${escapeText(view.notes)}`);
  lines.push(RULE, `**${WORDS.company} (${filled}/${view.slots.length})** ${fillBar(filled, view.slots.length)}`);
  return lines.join("\n");
}

const text = (content: string) => ({ type: 10, content });

// Small grey tips at the very bottom of a live roster (owner request 2026-10-08).
export const OWNER_TIPS = [
  "-# 💡 **Tips for the owner**",
  "-# `/content edit` changes the event · don't forget `/content end` when it is over · `/content help` for more",
].join("\n");

export function renderRosterMessage(view: RosterView): {
  flags: number;
  components: unknown[];
  allowed_mentions: { parse: [] };
} {
  const filled = view.slots.filter((s) => s.userId !== null).length;
  const live = view.status === "open" || view.status === "locked";

  // Keep the text under Discord's 4000: drop the weapon icons, then the notes, then cut rows, only if needed.
  let spaced = true;
  let withEmoji = true;
  let notes = true;
  const waitLen = Math.min(600, (view.waitlist ?? []).reduce((n, w) => n + 40 + w.role.length, 30)) + Math.min(600, (view.fills ?? []).length * 30 + 20);
  const fits = () => headerText(view, filled, notes, spaced).length + waitLen + OWNER_TIPS.length + rowLines(view.slots, withEmoji, spaced).reduce((n, l) => n + l.text.length + 1, 0) <= TEXT_LIMIT;
  if (!fits()) spaced = false;
  if (!fits()) withEmoji = false;
  if (!fits()) notes = false;

  const waiting = view.waitlist ?? [];
  const fills = view.fills ?? [];
  const fillText = fills.length ? `🔁 **Fill (${fills.length}):** ${fills.map((u) => `<@${u}>`).join(" · ")}`.slice(0, 600) : "";
  const waitText = [
    fillText,
    waiting.length
      ? `🕒 **Waitlist (${waiting.length}):** ${waiting.map((w, i) => `${i + 1}. <@${w.userId}> (${escapeText(w.role)})`).join(" · ")}`.slice(0, 600)
      : "",
  ].filter(Boolean).join("\n");
  const budget = TEXT_LIMIT - headerText(view, filled, notes, spaced).length - waitText.length - 2 - OWNER_TIPS.length;
  let used = 0;
  const kept = rowLines(view.slots, withEmoji, spaced).filter((l) => (used += l.text.length + 1) <= budget);
  while (kept.length > 0 && kept[kept.length - 1]!.heading) kept.pop(); // never end on a heading with no row

  // All rows in one text block. Leave is one shared button (owner decision 2026-10-07): Discord cannot enable a
  // control for some viewers only, so it is enabled while anyone is signed up and only acts for signed-up players.
  const body: unknown[] = [text(headerText(view, filled, notes, spaced)), text([...kept.map((l) => l.text), ...(waitText ? [waitText] : [])].join("\n"))];

  const open = view.slots.filter((s) => s.userId === null);
  if (view.status === "open" && !view.started && open.length > 0) {
    body.push({
      type: 1,
      components: [{
        type: 3, custom_id: `join:${view.id}`, placeholder: `Pick an open position (${open.length})`,
        options: [
          { label: "Fill (play any position)", value: FILL_VALUE, emoji: { name: "🔁" } },
          ...open.slice(0, 24).map((s) => ({
            label: Array.from(`${s.position}. ${s.role}${s.weapon ? ` - ${s.weapon}` : ""}${dutyDef(s.duty) ? ` - ${dutyDef(s.duty)!.label}` : ""}`).slice(0, 100).join(""),
            value: s.id,
            emoji: (s.weapon ? weaponEmojiByName(s.weapon) : null) ?? { name: roleIcon(s.role) },
          })),
        ],
      }],
    });
  }
  // A role with no open position can be waited for (FR-007, per role).
  const fullRoles = [...new Set(view.slots.map((s) => s.role))].filter(
    (role) => !view.slots.some((s) => s.role === role && s.userId === null),
  );
  if (view.status === "open" && !view.started && fullRoles.length > 0) {
    body.push({
      type: 1,
      components: [{
        type: 3, custom_id: `wait:${view.id}`, placeholder: "Join the waitlist for a full role",
        options: [
          { label: "Fill (play any position)", value: WAIT_FILL_VALUE, emoji: { name: "🔁" } },
          ...fullRoles.slice(0, 24).map((role) => ({
            label: Array.from(`${role} (all taken)`).slice(0, 100).join(""), value: role.slice(0, 100), emoji: { name: roleIcon(role) },
            description: `${waiting.filter((w) => w.role.toLowerCase() === role.toLowerCase()).length} waiting`,
          })),
        ],
      }],
    });
  }
  const buttons: unknown[] = [
    {
      type: 2, style: 4, label: "Leave", emoji: { name: "🚪" }, custom_id: `leave:${view.id}`,
      disabled: !(live && (filled > 0 || waiting.length > 0 || fills.length > 0)),
    },
  ];
  if (view.hasLoot) buttons.push(...voteButtons(view));
  // The owner pings the signed-up players by private message (checked when pressed; shown to everyone).
  buttons.push({
    type: 2, style: 2, label: "Ping players", emoji: { name: "📣" }, custom_id: `ping:${view.id}`,
    disabled: !(live && (filled > 0 || fills.length > 0)) || view.pinged === true,
  });
  // The owner places a fill in a position (FR-032); the button shows only while someone is waiting as a fill.
  if (live && fills.length > 0) buttons.push({ type: 2, style: 1, label: "Assign fill", emoji: { name: "🔁" }, custom_id: `fa:${view.id}` });
  body.push({ type: 1, components: buttons });
  if (live) body.push(text(OWNER_TIPS));

  return {
    flags: IS_COMPONENTS_V2,
    components: [{ type: 17, accent_color: embedColor(view.type, view.status, view.kind), components: body }],
    allowed_mentions: { parse: [] },
  };
}
