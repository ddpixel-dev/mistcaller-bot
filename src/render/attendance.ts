import type { Attendance } from "../db/attendance.ts";
import { BOMBERS_GROUP, withParty } from "../domain/parties.ts";
import { escapeText } from "./roster.ts";

// The private attendance form: pick everyone who attended; Submit records the rest as no-shows.
// With two parties, or Bombers (FR-071), it shows one group's players (at most 25, Discord's menu limit); the ids carry
// the group suffix (@2, @3 for Bombers).
export function renderAttendanceForm(a: Attendance, names: Record<string, string>, party?: number) {
  const title = escapeText(a.title);
  const grouped = !!party && (a.partyCount >= 2 || (a.bombers !== null && a.bombers !== undefined));
  const players = grouped ? a.players.filter((p) => p.party === party) : a.players;
  const two = grouped;
  const at = (id: string) => (grouped ? withParty(id, party!) : id);
  const group = party === BOMBERS_GROUP ? "Bombers" : `Party ${party}`;
  const lower = party === BOMBERS_GROUP ? "Bombers" : `party ${party}`;
  const every = a.bombers !== null && a.bombers !== undefined ? "every party and Bombers are" : "both parties are";
  if (players.length === 0) {
    return { content: `📋 **Attendance: ${title}**\nNobody was signed up, so there is nothing to record.`, components: [], allowed_mentions: { parse: [] as [] } };
  }
  const attended = players.filter((p) => a.marks[p.userId] === "attended").length;
  const options = players.slice(0, 25).map((p) => ({
    // A fill has no position, role or weapon; a slot without a weapon shows its role alone.
    label: Array.from(p.bomber ? `💣 ${names[p.userId] ?? `Bomber ${p.userId.slice(-4)}`}` : p.position === null ? `🔁 ${names[p.userId] ?? `Fill ${p.userId.slice(-4)}`}` : `${p.number ?? p.position}. ${names[p.userId] ?? `Player ${p.number ?? p.position}`}`).slice(0, 100).join(""),
    description: Array.from(p.bomber ? "Bomber" : p.fill ? "Fill" : `${p.role}${p.weapon ? ` - ${p.weapon}` : ""}`).slice(0, 100).join(""),
    value: p.userId,
    default: a.marks[p.userId] === "attended",
  }));
  return {
    content: [
      `📋 **Attendance: ${title}**${grouped ? ` (${group})` : ""}`,
      two
        ? `Pick everyone in ${group} who attended. **Submit ${lower}** records anyone in ${party === BOMBERS_GROUP ? "Bombers" : "this party"} not picked as a no-show. The report posts once ${every} submitted.${a.partiesSubmitted.includes(party!) ? ` (${group} is submitted; you can still change it until the report posts.)` : ""}`
        : "Pick everyone who attended. **Submit** records anyone not picked as a no-show and posts the report in the content's post.",
      `Picked so far: ${attended} of ${players.length}.`,
    ].join("\n"),
    components: [
      {
        type: 1,
        components: [{
          type: 3, custom_id: at(`att:pick:${a.contentId}`), placeholder: "Who attended? (pick all that did)",
          min_values: 0, max_values: options.length, options,
        }],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: two ? `Submit ${lower}` : "Submit", custom_id: at(`att:submit:${a.contentId}`) },
          { type: 2, style: 2, label: "Save and finish later", custom_id: at(`att:later:${a.contentId}`) },
        ],
      },
    ],
    allowed_mentions: { parse: [] as [] },
  };
}

// The report posted in the content's post. It mentions players so names show, but nobody is pinged.
export function renderReport(a: Attendance) {
  const ids = (status: "attended" | "no_show") => Object.entries(a.marks).filter(([, s]) => s === status).map(([u]) => `<@${u}>`);
  const attended = ids("attended");
  const noShow = ids("no_show");
  const unmarked = a.players.filter((p) => !a.marks[p.userId]).map((p) => `<@${p.userId}>`);
  const lines = [`📋 **Attendance: ${escapeText(a.title)}**`, `✅ **Attended (${attended.length}):** ${attended.join(" ") || "nobody"}`, `❌ **No-show (${noShow.length}):** ${noShow.join(" ") || "nobody"}`];
  if (unmarked.length) lines.push(`❔ **Not recorded (${unmarked.length}):** ${unmarked.join(" ")}`);
  return { content: lines.join("\n").slice(0, 2000), allowed_mentions: { parse: [] as [] } };
}
