import type { Deps, Handler } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, reply } from "../discord/response.ts";
import { getManageTarget, getManageTargetById } from "../db/manage.ts";
import { authorize, handleCancelCommand, handleEditCommand, handleLockCommand, handleUnlockCommand } from "./manage.ts";
import { handleAttendanceCommand, handleEndCommand } from "./attendance.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = "That panel is out of date. Press **Manage** on the roster again.";

// Each panel button runs its command (FR-048). The commands find the content from the post they are used in, and the
// panel is a private message in that same post, so they work unchanged; they check the member themselves.
const ACTIONS: Record<string, Handler> = {
  e: handleEditCommand, l: handleLockCommand, u: handleUnlockCommand, n: handleEndCommand, c: handleCancelCommand, a: handleAttendanceCommand,
};

const button = (label: string, emoji: string, custom_id: string, style = 2) => ({ type: 2, style, label, emoji: { name: emoji }, custom_id });

function panel(id: string, locked: boolean) {
  return {
    content: "🛠️ **Manage this content.** Only you can see this.",
    flags: EPHEMERAL,
    allowed_mentions: { parse: [] as [] },
    components: [
      {
        type: 1,
        components: [
          button("Edit", "✏️", `mg:e:${id}`, 1),
          button("Sign up player", "📝", `fa:${id}`, 1),
          button("Remove player", "➖", `rm:${id}`),
          button("Set duty", "📯", `dt:${id}`),
        ],
      },
      {
        type: 1,
        components: [
          locked ? button("Unlock", "🔓", `mg:u:${id}`) : button("Lock", "🔒", `mg:l:${id}`),
          button("End", "🏁", `mg:n:${id}`),
          button("Cancel", "✖️", `mg:c:${id}`, 4),
          button("Attendance", "📋", `mg:a:${id}`),
        ],
      },
    ],
  };
}

// mg:<content> (the Manage button on the roster) opens the panel; mg:<action>:<content> is a button on the panel.
export async function handleManageComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const parts = typeof raw === "string" ? raw.split(":") : [];
  if (parts[0] !== "mg" || !i.guild_id) return reply(INVALID);

  if (parts.length === 2 && UUID.test(parts[1]!)) {
    const checked = await authorize(deps, i, await getManageTargetById(deps.sql, parts[1]!));
    if (!checked.ok) return checked.response;
    const { status } = checked.target;
    if (status !== "open" && status !== "locked") return reply("This content is finished or cancelled.");
    return { type: CHANNEL_MESSAGE, data: panel(checked.target.id, status === "locked") };
  }

  const action = parts.length === 3 && Object.hasOwn(ACTIONS, parts[1]!) ? ACTIONS[parts[1]!] : undefined;
  if (!action || !UUID.test(parts[2]!)) return reply(INVALID);
  // The panel must still belong to this post's content (a stale panel never acts on another one).
  const target = i.channel?.id ? await getManageTarget(deps.sql, i.guild_id, i.channel.id) : null;
  if (!target || target.id !== parts[2]) return reply(INVALID);
  return await action(deps, i);
}
