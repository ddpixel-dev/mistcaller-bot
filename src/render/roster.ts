import { buildRefText } from "../domain/buildref.ts";
import type { RosterSlot, RosterView } from "../domain/types.ts";
import { DEFAULT_KIND, TYPE_LABEL, kindDef, kindIcon } from "../domain/kinds.ts";
import { dutyDef } from "../domain/duties.ts";
import { displayNumber, partyLead, withParty } from "../domain/parties.ts";
import { CANCELLED_TAG, RULE, VOTE_ICON, WORDS, embedColor, fillBar, roleIcon, statusBanner } from "./theme.ts";
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

// Values of the join menu and the waitlist menu for Fill (FR-057: both open the fill panel; a waiting player may choose Fill again). It was
// understood from rosters rendered before that. `~` cannot start a slot id, and no role is typed that way.
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

// The rows (ADR 0028, owner decision 2026-10-24): one numbered line per position, with no role headings. A row reads
// `n. RoleIcon Role - WeaponIcon Weapon - Player - DutyIcon Duty` (`Open` for an empty position); the duty only when set.
// The weapon icon on each row is enough: the line of only weapon icons (FR-046) was removed (ADR 0029).
function rowLines(slots: RosterSlot[], withEmoji: boolean, tentative: string[] = [], all: RosterSlot[] = slots): string[] {
  return slots.map((s) => {
    // A role-only slot shows the holder's own weapon once chosen, and "Player's choice" until then (FR-030).
    const weaponName = s.weapon || s.chosenWeapon || "";
    const emoji = withEmoji && weaponName ? weaponEmojiTag(weaponName) : "";
    const duty = dutyDef(s.duty);
    return `${displayNumber(s, all)}. ${roleIcon(s.role)} ${escapeText(s.role)} - ${emoji ? `${emoji} ` : ""}${weaponName ? escapeText(weaponName) : WORDS.choice} - ${
      s.userId ? `<@${s.userId}>${tentative.includes(s.userId) ? TENTATIVE : ""}` : WORDS.open
    }${duty ? ` - ${duty.icon} ${duty.label}` : ""}`;
  });
}

// The header labels start their values in one column: each label is followed by this many EN SPACEs. The counts were
// measured on a screenshot of Discord's desktop text (a label's width, plus 6.7 px per en space, plus about 4 px),
// so the columns agree to within a few pixels. Discord's font is proportional, so this cannot be exact.
const EN = "\u2002";
const HEADER_PAD: Record<string, number> = { Type: 6, Host: 6, "Gear tier": 3, Build: 6, UTC: 7, "Your time": 2, "Massing at": 2 };

function headerText(view: RosterView, filled: number, notes: boolean, count = { filled, of: view.slots.length }): string {
  const epoch = Math.floor(view.startsAt.getTime() / 1000);
  const typeLabel = TYPE_LABEL[view.type];
  const def = kindDef(view.type, view.kind);
  const kind = def && def.id !== DEFAULT_KIND ? `${typeLabel} · ${def.label}` : typeLabel;
  const title = view.status === "cancelled"
    ? `${CANCELLED_TAG} ${escapeText(view.title)}`
    : `${kindIcon(view.type, view.kind)} ${escapeText(view.title)}`; // one icon: the category's (ADR 0030)
  const fact = (icon: string, label: string, value: string) => `${icon} **${label}**${EN.repeat(HEADER_PAD[label] ?? 2)}${value}`;
  const lines = [
    // A level-2 heading (ADR 0028: the level-1 title made the roster too tall).
    `## ${Array.from(title).slice(0, TITLE_LIMIT).join("")}`,
    fact("🏷️", "Type", `**${kind}**`), // not ⚔️, which is also the title icon of Small-scale and PvP Other (ADR 0031)
    // FR-064: the creator, as a mention (it shows a name and never pings: every message sends no mentions).
    ...(view.ownerId ? [fact("👑", "Host", `<@${view.ownerId}>`)] : []),
    // FR-074: where the party gathers, typed by the host.
    ...(view.massing ? [fact("📍", "Massing at", massingText(view.massing))] : []),
    ...(view.selection ? [SELECTION_NOTE] : []),
    fact("⚙️", "Gear tier", view.tier === "" ? "Any" : escapeText(view.tier)),
    ...(view.buildRef ? [fact("🧰", "Build", buildRefText(view.buildRef, view.guildId))] : []),
    fact("🕰️", "UTC", formatUtc(view.startsAt)),
    fact("🌍", "Your time", `<t:${epoch}:f> · <t:${epoch}:R>`),
  ];
  const banner = statusBanner(view.status);
  if (banner) lines.push(banner);
  if (notes && view.notes) lines.push(`📝 **${view.blank ? "Description" : "Notes"}:** ${escapeText(view.notes)}`);
  // A blank content has no roster, so no party line (FR-060).
  // With two parties the rule is followed by the party headings, each with its own count (ADR 0047).
  if (!view.blank) lines.push(RULE, ...(view.partyCount > 1 ? [] : [partyCountLine(count.filled, count.of)]));
  return lines.join("\n");
}

// FR-067: shown after a tentative player's name, wherever the player is listed.
export const TENTATIVE = " ❓";

// FR-058: the disclaimer of a host-selected event, in the post itself.
export const SELECTION_NOTE = "Host picks the party";

// The host's text, escaped; a channel mention (<#id>) stays a link. Mentions never ping: every message sends none.
export function massingText(s: string): string {
  return s.split(/(<#\d{5,25}>)/).map((part, n) => (n % 2 === 1 ? part : escapeText(part))).join("");
}

const partyCountLine = (filled: number, of: number) => `**${WORDS.company} (${filled}/${of})** ${fillBar(filled, of)}`;

const text = (content: string) => ({ type: 10, content });

// Small grey tips at the very bottom of a live roster (owner request 2026-10-08).
export const OWNER_TIPS = [
  "-# 💡 **Tips for the owner**",
  "-# 🛠️ Press **Manage** to edit, add players, end or cancel · `/content help` for more",
].join("\n");

// `party` picks which message of a call to arms to render (FR-070). Party 1 is the whole message of any other content;
// a later party shows only its rows, lists and menus, with every custom id ending in its party.
export function renderRosterMessage(view: RosterView, party = 1): {
  flags: number;
  components: unknown[];
  allowed_mentions: { parse: [] };
} {
  // ADR 0047: a call to arms is one message holding every party, so `party` does not apply to it.
  if (view.cta && !view.blank) return renderCtaMessage(view);
  return renderPartyMessage(view, party);
}

function renderPartyMessage(view: RosterView, party: number): {
  flags: number;
  components: unknown[];
  allowed_mentions: { parse: [] };
} {
  const filled = view.slots.filter((s) => s.userId !== null).length; // the whole content
  const mine = view.slots.filter((s) => s.party === party);
  const myFilled = mine.filter((s) => s.userId !== null).length;
  const count = { filled: myFilled, of: mine.length };
  const inParty = (u: string, explicit?: number) => (explicit ?? view.partyOf?.[u] ?? 1) === party;
  const first = party === 1;
  const tips = first ? OWNER_TIPS.length : 0;
  const id = (c: string) => withParty(c, party);
  const live = view.status === "open" || view.status === "locked";

  // FR-060: a blank content is its details and a Manage button: no roster, menus, Leave, vote or Ping.
  if (view.blank) {
    const parts: unknown[] = [text(headerText(view, 0, true))];
    if (live || view.status === "done") parts.push({ type: 1, components: [{ type: 2, style: 2, label: "Manage", emoji: { name: "🛠️" }, custom_id: `mg:${view.id}` }] });
    if (live) parts.push(text(OWNER_TIPS));
    return {
      flags: IS_COMPONENTS_V2,
      components: [{ type: 17, accent_color: embedColor(view.type, view.status, view.kind), components: parts }],
      allowed_mentions: { parse: [] },
    };
  }

  // Keep the text under Discord's 4000: drop the weapon icons, then the notes, then cut rows, only if needed.
  let withEmoji = true;
  let notes = true;
  const waitingAll = (view.waitlist ?? []).filter((w) => inParty(w.userId, w.party));
  const fillsAll = (view.fills ?? []).filter((u) => inParty(u));
  const applicantsAll = (view.applicants ?? []).filter((a) => inParty(a.userId));
  const waitLen = Math.min(600, waitingAll.reduce((n, w) => n + 40 + w.role.length, 30)) + Math.min(600, fillsAll.length * 50 + 20) + Math.min(600, applicantsAll.length * 50 + 20) + 2;
  const tent = (u: string) => (view.tentative?.includes(u) ? TENTATIVE : "");
  const waitTentative = (view.tentative ?? []).length * TENTATIVE.length;
  const fits = () => headerText(view, filled, notes, count).length + waitLen + waitTentative + tips + rowLines(mine, withEmoji, view.tentative, view.slots).reduce((n, l) => n + l.length + 1, 0) <= TEXT_LIMIT;
  if (!fits()) withEmoji = false;
  if (!fits()) notes = false;

  const waiting = waitingAll;
  const fills = fillsAll;
  const fillText = fills.length
    ? `🔁 **Fill (${fills.length}):** ${fills.map((u) => `<@${u}>${tent(u)} (${escapeText(view.fillWants?.[u] ?? "Any")})`).join(" · ")}`.slice(0, 600)
    : "";
  const applicants = applicantsAll;
  const applicantText = applicants.length
    ? `📨 **Applicants (${applicants.length}):** ${applicants.map((a) => `<@${a.userId}>${tent(a.userId)} (${escapeText(a.wants)})`).join(" · ")}`.slice(0, 600)
    : "";
  const waitText = [
    applicantText,
    fillText,
    waiting.length
      ? `🕒 **Waitlist (${waiting.length}):** ${waiting.map((w, i) => `${i + 1}. <@${w.userId}>${tent(w.userId)} (${escapeText(w.role)})`).join(" · ")}`.slice(0, 600)
      : "",
  ].filter(Boolean).join("\n");
  const budget = TEXT_LIMIT - headerText(view, filled, notes, count).length - waitText.length - 2 - tips;
  let used = 0;
  const kept = rowLines(mine, withEmoji, view.tentative, view.slots).filter((l) => (used += l.length + 1) <= budget);

  // All rows in one text block. Leave is one shared button (owner decision 2026-10-07): Discord cannot enable a
  // control for some viewers only, so it is enabled while anyone is signed up and only acts for signed-up players.
  // A blank line sets the applicants apart from the players (owner request 2026-11-06).
  const body: unknown[] = [text(headerText(view, filled, notes, count)), text([...kept, ...(waitText ? [...(applicantText ? [""] : []), waitText] : [])].join("\n"))];

  const open = mine.filter((s) => s.userId === null);
  if (view.status === "open" && open.length > 0) {
    body.push({
      type: 1,
      components: [{
        type: 3, custom_id: id(`join:${view.id}`), placeholder: view.selection ? `Apply for a position (${open.length})` : `Pick an open position (${open.length})`,
        options: [
          { label: "Fill (choose what you can play)", value: FILL_VALUE, emoji: { name: "🔁" } },
          ...open.slice(0, 24).map((s) => ({
            label: Array.from(`${displayNumber(s, view.slots)}. ${s.role}${s.weapon ? ` - ${s.weapon}` : ""}${dutyDef(s.duty) ? ` - ${dutyDef(s.duty)!.label}` : ""}`).slice(0, 100).join(""),
            value: s.id,
            emoji: (s.weapon ? weaponEmojiByName(s.weapon) : null) ?? { name: roleIcon(s.role) },
          })),
        ],
      }],
    });
  }
  // A role with no open position can be waited for (FR-007, per role).
  const fullRoles = [...new Set(mine.map((s) => s.role))].filter(
    (role) => !mine.some((s) => s.role === role && s.userId === null),
  );
  if (view.status === "open" && fullRoles.length > 0 && !view.selection) {
    body.push({
      type: 1,
      components: [{
        type: 3, custom_id: id(`wait:${view.id}`), placeholder: "Join the waitlist for a full role",
        options: [
          { label: "Fill (choose what you can play)", value: WAIT_FILL_VALUE, emoji: { name: "🔁" } },
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
      type: 2, style: 4, label: "Leave", emoji: { name: "🚪" }, custom_id: id(`leave:${view.id}`),
      disabled: !(live && (myFilled > 0 || waiting.length > 0 || fills.length > 0 || applicants.length > 0)),
    },
  ];
  // FR-067: one shared button for everyone, like Leave; it acts for whoever presses it, and the ❓ shows on the roster.
  buttons.push({
    type: 2, style: 2, label: "Tentative", emoji: { name: "❓" }, custom_id: id(`tent:${view.id}`),
    disabled: !(live && (myFilled > 0 || waiting.length > 0 || fills.length > 0 || applicants.length > 0)),
  });
  if (first && view.hasLoot) buttons.push(...voteButtons(view));
  // The owner pings the signed-up players by private message (checked when pressed; shown to everyone).
  if (first) buttons.push({
    type: 2, style: 2, label: "Ping players", emoji: { name: "📣" }, custom_id: `ping:${view.id}`,
    disabled: !(live && (view.pingLeft !== undefined ? view.pingLeft > 0 : filled > 0 || (view.fills ?? []).length > 0)), // the whole content
  });
  // The creator and admins open their private Manage panel (FR-048); checked when pressed, shown to everyone. A finished
  // roster keeps it, the one enabled control, for the attendance and reopen (ADR 0029).
  if (first && (live || view.status === "done")) buttons.push({ type: 2, style: 2, label: "Manage", emoji: { name: "🛠️" }, custom_id: `mg:${view.id}` });
  // A row holds five buttons at most.
  for (let n = 0; n < buttons.length; n += 5) body.push({ type: 1, components: buttons.slice(n, n + 5) });
  if (live && first) body.push(text(OWNER_TIPS));

  return {
    flags: IS_COMPONENTS_V2,
    components: [{ type: 17, accent_color: embedColor(view.type, view.status, view.kind), components: body }],
    allowed_mentions: { parse: [] },
  };
}

// The whole call to arms in one message (ADR 0047, FR-070, FR-071): the header; each party's heading and rows (the
// heading only with two parties); the Bombers line; the applicants, fill and waitlist lines (with a party lead only with
// two parties); one join menu and one waitlist menu per party; shared Leave and Tentative (a player holds one place);
// Bombers; the vote, Ping and Manage; the tips. One party with no Bombers renders as a one-party roster always has.
// The icon of each party's title in a call to arms.
const PARTY_ICONS = ["⚔️", "🛡️"];

function renderCtaMessage(view: RosterView): {
  flags: number;
  components: unknown[];
  allowed_mentions: { parse: [] };
} {
  const parties = Array.from({ length: Math.max(1, view.partyCount) }, (_, i) => i + 1);
  const many = parties.length > 1;
  const filled = view.slots.filter((s) => s.userId !== null).length;
  const live = view.status === "open" || view.status === "locked";
  const partyOfUser = (u: string, explicit?: number) => explicit ?? view.partyOf?.[u] ?? 1;
  const tent = (u: string) => (view.tentative?.includes(u) ? TENTATIVE : "");
  const waitlist = view.waitlist ?? [];
  const fills = view.fills ?? [];
  const applicants = view.applicants ?? [];
  const bomberIds = view.bomberIds ?? [];

  // Each group (a party, then Bombers) has an icon in its title and a blank line after its list (owner request 2026-11-11).
  const showHeads = many || (view.bombers !== null && view.bombers !== undefined);
  const per = parties.map((party) => {
    const mine = view.slots.filter((s) => s.party === party);
    return {
      party,
      mine,
      heading: showHeads ? `${PARTY_ICONS[(party - 1) % PARTY_ICONS.length]} **Party ${party} (${mine.filter((s) => s.userId !== null).length}/${mine.length})** ${fillBar(mine.filter((s) => s.userId !== null).length, mine.length)}` : null,
      waiting: waitlist.filter((w) => partyOfUser(w.userId, w.party) === party),
      fills: fills.filter((u) => partyOfUser(u) === party),
      applicants: applicants.filter((a) => partyOfUser(a.userId) === party),
    };
  });
  const lead = (party: number) => partyLead(view.partyCount, party);
  // Each line is cut at 600 characters, as before; the party lead is part of the line.
  const applicantLines = per.filter((x) => x.applicants.length).map((x) =>
    `${lead(x.party)}📨 **Applicants (${x.applicants.length}):** ${x.applicants.map((a) => `<@${a.userId}>${tent(a.userId)} (${escapeText(a.wants)})`).join(" · ")}`.slice(0, 600));
  const fillLines = per.filter((x) => x.fills.length).map((x) =>
    `${lead(x.party)}🔁 **Fill (${x.fills.length}):** ${x.fills.map((u) => `<@${u}>${tent(u)} (${escapeText(view.fillWants?.[u] ?? "Any")})`).join(" · ")}`.slice(0, 600));
  const waitLines = per.filter((x) => x.waiting.length).map((x) =>
    `${lead(x.party)}🕒 **Waitlist (${x.waiting.length}):** ${x.waiting.map((w, i) => `${i + 1}. <@${w.userId}>${tent(w.userId)} (${escapeText(w.role)})`).join(" · ")}`.slice(0, 600));
  const waitText = [...applicantLines, ...fillLines, ...waitLines].join("\n");
  const bomberText = view.bombers !== null && view.bombers !== undefined
    ? `**💣 Bombers (${bomberIds.length}/${view.bombers})${bomberIds.length ? `:** ${bomberIds.map((u) => `<@${u}>${tent(u)}`).join(" · ")}` : "**"}`.slice(0, 600)
    : "";
  const tips = OWNER_TIPS.length;
  // The blank lines after each list count in the budget.
  const headings = per.reduce((n, x) => n + (x.heading ? x.heading.length + 1 : 0), 0) + (showHeads ? per.length : 0);
  // The tail after the rows: the Bombers line and a blank line, a blank line before the applicants when no group set one, then the lists.
  const tail = [...(bomberText ? [bomberText, ""] : []), ...(waitText ? [...(applicantLines.length && !showHeads ? [""] : []), waitText] : [])];
  const tailLen = tail.reduce((n, l) => n + l.length + 1, 0);

  // Keep the text under Discord's 4000 over the whole message: drop the weapon icons, then the notes, then cut rows.
  let withEmoji = true;
  let notes = true;
  const head = () => headerText(view, filled, notes);
  const rowsLen = () => per.reduce((n, x) => n + rowLines(x.mine, withEmoji, view.tentative, view.slots).reduce((m, l) => m + l.length + 1, 0), 0);
  const fits = () => head().length + headings + tailLen + tips + rowsLen() <= TEXT_LIMIT;
  if (!fits()) withEmoji = false;
  if (!fits()) notes = false;
  const budget = TEXT_LIMIT - head().length - headings - tailLen - tips;
  let used = 0;
  const rowBlock: string[] = [];
  for (const x of per) {
    if (x.heading) rowBlock.push(x.heading);
    rowBlock.push(...rowLines(x.mine, withEmoji, view.tentative, view.slots).filter((l) => (used += l.length + 1) <= budget));
    if (showHeads) rowBlock.push("");
  }
  const body: unknown[] = [text(head()), text([...rowBlock, ...tail].join("\n"))];

  if (view.status === "open") {
    for (const x of per) {
      const open = x.mine.filter((s) => s.userId === null);
      if (open.length === 0) continue;
      const placeholder = view.selection
        ? (many ? `Party ${x.party}: apply for a position (${open.length})` : `Apply for a position (${open.length})`)
        : (many ? `Party ${x.party}: pick an open position (${open.length})` : `Pick an open position (${open.length})`);
      body.push({
        type: 1,
        components: [{
          type: 3, custom_id: withParty(`join:${view.id}`, x.party), placeholder,
          options: [
            { label: "Fill (choose what you can play)", value: FILL_VALUE, emoji: { name: "🔁" } },
            ...open.slice(0, 24).map((s) => ({
              label: Array.from(`${displayNumber(s, view.slots)}. ${s.role}${s.weapon ? ` - ${s.weapon}` : ""}${dutyDef(s.duty) ? ` - ${dutyDef(s.duty)!.label}` : ""}`).slice(0, 100).join(""),
              value: s.id,
              emoji: (s.weapon ? weaponEmojiByName(s.weapon) : null) ?? { name: roleIcon(s.role) },
            })),
          ],
        }],
      });
    }
    // A role with no open position in that party can be waited for (FR-007, per role).
    for (const x of view.selection ? [] : per) {
      const fullRoles = [...new Set(x.mine.map((s) => s.role))].filter((role) => !x.mine.some((s) => s.role === role && s.userId === null));
      if (fullRoles.length === 0) continue;
      body.push({
        type: 1,
        components: [{
          type: 3, custom_id: withParty(`wait:${view.id}`, x.party),
          placeholder: many ? `Party ${x.party}: join the waitlist for a full role` : "Join the waitlist for a full role",
          options: [
            { label: "Fill (choose what you can play)", value: WAIT_FILL_VALUE, emoji: { name: "🔁" } },
            ...fullRoles.slice(0, 24).map((role) => ({
              label: Array.from(`${role} (all taken)`).slice(0, 100).join(""), value: role.slice(0, 100), emoji: { name: roleIcon(role) },
              description: `${x.waiting.filter((w) => w.role.toLowerCase() === role.toLowerCase()).length} waiting`,
            })),
          ],
        }],
      });
    }
  }

  // One shared Leave and Tentative for the whole call to arms: a player holds one place (seat, waitlist, fill,
  // application or Bombers), and the button acts on it.
  const anyone = filled > 0 || waitlist.length > 0 || fills.length > 0 || applicants.length > 0 || bomberIds.length > 0;
  const buttons: unknown[] = [
    { type: 2, style: 4, label: "Leave", emoji: { name: "🚪" }, custom_id: `leave:${view.id}`, disabled: !(live && anyone) },
    { type: 2, style: 2, label: "Tentative", emoji: { name: "❓" }, custom_id: `tent:${view.id}`, disabled: !(live && anyone) },
  ];
  if (view.bombers !== null && view.bombers !== undefined) buttons.push({
    type: 2, style: 2, label: `Bombers ${bomberIds.length}/${view.bombers}`, emoji: { name: "💣" }, custom_id: `bomb:${view.id}`,
    disabled: view.status !== "open" || bomberIds.length >= view.bombers,
  });
  if (view.hasLoot) buttons.push(...voteButtons(view));
  buttons.push({
    type: 2, style: 2, label: "Ping players", emoji: { name: "📣" }, custom_id: `ping:${view.id}`,
    disabled: !(live && (view.pingLeft !== undefined ? view.pingLeft > 0 : filled > 0 || fills.length > 0 || bomberIds.length > 0)),
  });
  if (live || view.status === "done") buttons.push({ type: 2, style: 2, label: "Manage", emoji: { name: "🛠️" }, custom_id: `mg:${view.id}` });
  for (let n = 0; n < buttons.length; n += 5) body.push({ type: 1, components: buttons.slice(n, n + 5) });
  if (live) body.push(text(OWNER_TIPS));

  return {
    flags: IS_COMPONENTS_V2,
    components: [{ type: 17, accent_color: embedColor(view.type, view.status, view.kind), components: body }],
    allowed_mentions: { parse: [] },
  };
}

// A 0.31.8 call to arms had a second message for party 2. Now that the roster above holds both parties, that message
// is edited once into this note, with no controls (ADR 0047).
export function renderMovedNote(): { flags: number; components: unknown[]; allowed_mentions: { parse: [] } } {
  return {
    flags: IS_COMPONENTS_V2,
    components: [{ type: 17, components: [text("This party is now shown in the roster above.")] }],
    allowed_mentions: { parse: [] },
  };
}

// A link back to the roster, for the bot's own posts in the thread: the roster scrolls away as people talk. A link button
// sits under the message instead of adding a line of text (owner request 2026-11-06).
// The roster sits in its own channel for a call to arms (ADR 0047: `rosterChannelId`), in the thread otherwise.
export type RosterLink = { guildId: string; threadId: string; messageId: string | null; rosterChannelId?: string | null };
export function rosterUrl(v: RosterLink): string {
  return `https://discord.com/channels/${v.guildId}/${v.rosterChannelId ?? v.threadId}${v.messageId ? `/${v.messageId}` : ""}`;
}
export function rosterButton(v: RosterLink): unknown[] {
  return [{ type: 1, components: [{ type: 2, style: 5, label: "Roster", emoji: { name: "📋" }, url: rosterUrl(v) }] }];
}
