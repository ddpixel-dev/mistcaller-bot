import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, MODAL, reply } from "../discord/response.ts";
import { modalValues, textInput } from "../discord/modal.ts";
import { getRetry, saveRetry } from "../db/retry.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPIRED = "That form is no longer kept. Run the command again.";

// The five fields of the create and edit forms. Their texts are the same in both.
const FIELDS = ["title", "start", "tier", "slots", "notes"] as const;

// A form had mistakes (owner decision 2026-10-09, ADR 0025): list all of them and keep what was typed, so the
// "Fix and retry" button can reopen the form filled in. Discord cannot validate inside an open form.
export async function formProblems(deps: Deps, i: Interaction, formId: string, problems: string[]): Promise<InteractionResponse> {
  const userId = i.member?.user?.id;
  const threadId = i.channel?.id;
  if (!i.guild_id || !userId || !threadId) return reply(problems.join("\n"));
  const v = modalValues(i);
  const fields = Object.fromEntries(FIELDS.map((f) => [f, v[f] ?? ""]));
  const id = await saveRetry(deps.sql, { guildId: i.guild_id, userId, threadId, formId, fields, now: deps.now() });
  const list = problems.map((p) => `• ${p}`).join("\n");
  return {
    type: CHANNEL_MESSAGE,
    data: {
      content: `${problems.length === 1 ? "The form has a mistake" : `The form has ${problems.length} mistakes`}:\n${list}\n\nPress **Fix and retry**: the form opens again with what you typed.`.slice(0, 1900),
      flags: EPHEMERAL,
      allowed_mentions: { parse: [] },
      components: [{ type: 1, components: [{ type: 2, style: 1, label: "Fix and retry", emoji: { name: "✏️" }, custom_id: `rt:${id}` }] }],
    },
  };
}

// rt:<id>: reopen the form that had mistakes, with the member's text in it.
export async function handleRetryComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const id = typeof raw === "string" ? raw.split(":")[1] : undefined;
  const userId = i.member?.user?.id;
  if (!id || !UUID.test(id) || !i.guild_id || !userId) return reply(EXPIRED);
  const stored = await getRetry(deps.sql, id, i.guild_id, userId, deps.now());
  if (!stored) return reply(EXPIRED);
  const f = stored.fields;
  const filled = (name: string) => (f[name] ? { value: f[name] } : {});
  return {
    type: MODAL,
    data: {
      custom_id: stored.formId,
      title: stored.formId.startsWith("edit:") ? "Edit content" : "Create content",
      components: [
        textInput("title", "Title", 100, filled("title")),
        textInput("start", "Start time (UTC, YYYY-MM-DD HH:mm)", 20, filled("start")),
        textInput("tier", "Gear Tier", 80, filled("tier")),
        textInput("slots", "Slots (one per line: Role - Weapon)", 1500, { style: 2, ...filled("slots") }),
        textInput("notes", "Notes (optional)", 500, { required: false, ...filled("notes") }),
      ],
    },
  };
}
