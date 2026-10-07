import type { Attendance } from "../db/attendance.ts";
import { escapeText } from "./roster.ts";

// The private attendance form: pick everyone who attended; Submit records the rest as no-shows.
export function renderAttendanceForm(a: Attendance, names: Record<string, string>) {
  const title = escapeText(a.title);
  if (a.players.length === 0) {
    return { content: `📋 **Attendance: ${title}**\nNobody was signed up, so there is nothing to record.`, components: [], allowed_mentions: { parse: [] as [] } };
  }
  const attended = a.players.filter((p) => a.marks[p.userId] === "attended").length;
  const options = a.players.slice(0, 25).map((p) => ({
    label: Array.from(`${p.position}. ${names[p.userId] ?? `Player ${p.position}`}`).slice(0, 100).join(""),
    description: Array.from(`${p.role} - ${p.weapon}`).slice(0, 100).join(""),
    value: p.userId,
    default: a.marks[p.userId] === "attended",
  }));
  return {
    content: [
      `📋 **Attendance: ${title}**`,
      "Pick everyone who attended. **Submit** records anyone not picked as a no-show and posts the report in the content's post.",
      `Picked so far: ${attended} of ${a.players.length}.`,
    ].join("\n"),
    components: [
      {
        type: 1,
        components: [{
          type: 3, custom_id: `att:pick:${a.contentId}`, placeholder: "Who attended? (pick all that did)",
          min_values: 0, max_values: options.length, options,
        }],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: "Submit", custom_id: `att:submit:${a.contentId}` },
          { type: 2, style: 2, label: "Save and finish later", custom_id: `att:later:${a.contentId}` },
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
