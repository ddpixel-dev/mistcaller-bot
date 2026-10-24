import type { Deps, Handler } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { CHANNEL_MESSAGE, EPHEMERAL, MODAL, UPDATE_MESSAGE, reply } from "../discord/response.ts";
import { modalValues, textInput } from "../discord/modal.ts";
import { getManageTarget, getManageTargetById, updateContentSettings } from "../db/manage.ts";
import { getRosterView } from "../db/content.ts";
import { authorize, handleCancel, handleLock, handleUnlock, openEditForm, refreshRoster } from "./manage.ts";
import { handleAttendance, handleEnd, handleReopen } from "./attendance.ts";
import { refreshDashboardSoon } from "../jobs/dashboards.ts";
import { kindsOf, resolveKind } from "../domain/kinds.ts";
import { parseBuildReference } from "../domain/buildref.ts";
import type { RosterView } from "../domain/types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = "That panel is out of date. Press **Manage** on the roster again.";
const NOT_OPEN = "Only open content can be edited. Locked, finished or cancelled content cannot.";

// Each panel button runs the host action that used to be a command (FR-048, ADR 0029). The actions find the content
// from the post they are used in, and the panel is a private message in that same post; they check the member themselves.
const ACTIONS: Record<string, Handler> = {
  f: openEditForm, l: handleLock, u: handleUnlock, n: handleEnd, c: handleCancel, a: handleAttendance, r: handleReopen,
};

const button = (label: string, emoji: string, custom_id: string, style = 2) => ({ type: 2, style, label, emoji: { name: emoji }, custom_id });

function panel(view: RosterView) {
  const id = view.id;
  const rows: unknown[] = view.status === "done"
    // A finished roster keeps Manage for what comes after the content (ADR 0029).
    ? [{ type: 1, components: [button("Attendance", "📋", `mg:a:${id}`), button("Reopen", "🔁", `mg:r:${id}`)] }]
    : [
      {
        type: 1,
        components: [
          button("Edit", "✏️", `mg:e:${id}`, 1),
          // A green button (owner request 2026-10-24); the owner chose the ✍️ icon.
          button("Add player", "✍️", `fa:${id}`, 3),
          button("Remove player", "❌", `rm:${id}`),
          button("Set duty", "📯", `dt:${id}`),
          // Only while a position has no weapon (ADR 0029).
          ...(view.slots.some((s) => !s.weapon) ? [button("Set weapon", "🗡️", `sw:${id}`)] : []),
        ],
      },
      {
        type: 1,
        components: [
          view.status === "locked" ? button("Unlock", "🔓", `mg:u:${id}`) : button("Lock", "🔒", `mg:l:${id}`),
          button("End", "🏁", `mg:n:${id}`),
          button("Cancel", "✖️", `mg:c:${id}`, 4),
          button("Attendance", "📋", `mg:a:${id}`),
        ],
      },
    ];
  return { content: "🛠️ **Manage this content.** Only you can see this.", flags: EPHEMERAL, allowed_mentions: { parse: [] as [] }, components: rows };
}

// The Edit panel (ADR 0029): the category and the loot vote as menus that apply at once, the form for the text, and a
// one-field form for the build link. It replaces the options of the old /content edit.
function editPanel(view: RosterView, note: string | null) {
  const id = view.id;
  return {
    content: `✏️ **Edit the event.** Menu changes apply at once.${note ? `\n${note}` : ""}`,
    allowed_mentions: { parse: [] as [] },
    components: [
      {
        type: 1,
        components: [{
          type: 3, custom_id: `ed:k:${id}`, placeholder: "Category",
          options: kindsOf(view.type).map((k) => ({ label: k.label, value: k.id, default: k.id === view.kind })),
        }],
      },
      {
        type: 1,
        components: [{
          type: 3, custom_id: `ed:l:${id}`, placeholder: "Loot vote",
          options: [
            { label: "Loot vote on", value: "1", default: view.hasLoot, emoji: { name: "💰" } },
            { label: "Loot vote off", value: "0", default: !view.hasLoot },
          ],
        }],
      },
      { type: 1, components: [button("Edit details", "📝", `mg:f:${id}`, 1), button("Build link", "🧰", `ed:b:${id}`)] },
    ],
  };
}

// mg:<content> (the Manage button on the roster) opens the panel; mg:e:<content> opens the Edit panel;
// mg:<action>:<content> is another button on the panel.
export async function handleManageComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const parts = typeof raw === "string" ? raw.split(":") : [];
  if (parts[0] !== "mg" || !i.guild_id) return reply(INVALID);

  if (parts.length === 2 && UUID.test(parts[1]!)) {
    const checked = await authorize(deps, i, await getManageTargetById(deps.sql, parts[1]!));
    if (!checked.ok) return checked.response;
    const view = await getRosterView(deps.sql, checked.target.id, deps.now());
    if (!view || view.status === "cancelled") return reply("This content is cancelled.");
    return { type: CHANNEL_MESSAGE, data: panel(view) };
  }

  if (parts.length === 3 && parts[1] === "e" && UUID.test(parts[2]!)) {
    const checked = await authorize(deps, i, await getManageTargetById(deps.sql, parts[2]!));
    if (!checked.ok) return checked.response;
    if (checked.target.status !== "open") return reply(NOT_OPEN);
    const view = await getRosterView(deps.sql, checked.target.id, deps.now());
    if (!view) return reply(INVALID);
    return { type: CHANNEL_MESSAGE, data: { ...editPanel(view, null), flags: EPHEMERAL } };
  }

  const action = parts.length === 3 && Object.hasOwn(ACTIONS, parts[1]!) ? ACTIONS[parts[1]!] : undefined;
  if (!action || !UUID.test(parts[2]!)) return reply(INVALID);
  // The panel must still belong to this post's content (a stale panel never acts on another one).
  const target = i.channel?.id ? await getManageTarget(deps.sql, i.guild_id, i.channel.id) : null;
  if (!target || target.id !== parts[2]) return reply(INVALID);
  return await action(deps, i);
}

async function applied(deps: Deps, view: RosterView): Promise<void> {
  await refreshRoster(deps, view.id);
  await refreshDashboardSoon(deps, view.guildId, "schedule");
}

const linkOf = (ref: string, guildId: string) => `https://discord.com/channels/${guildId}/${ref}`;

// ed:k:<content> (a category), ed:l:<content> (the loot vote), ed:b:<content> (the Build link form).
export async function handleEditPanelComponent(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const data = i.data as { custom_id?: unknown; values?: unknown } | undefined;
  const parts = typeof data?.custom_id === "string" ? data.custom_id.split(":") : [];
  const values = Array.isArray(data?.values) ? data!.values : [];
  if (parts.length !== 3 || parts[0] !== "ed" || !UUID.test(parts[2]!) || !i.guild_id) return reply(INVALID);
  const id = parts[2]!;
  const checked = await authorize(deps, i, await getManageTargetById(deps.sql, id));
  if (!checked.ok) return checked.response;
  const view = await getRosterView(deps.sql, id, deps.now());
  if (!view) return reply(INVALID);
  if (view.status !== "open") return reply(NOT_OPEN);

  if (parts[1] === "b") {
    return {
      type: MODAL,
      data: {
        custom_id: `edb:${id}`,
        title: "Build link",
        components: [textInput("link", "Link to a channel, post or message", 200, {
          required: false, placeholder: "Leave empty to remove the build link", ...(view.buildRef ? { value: linkOf(view.buildRef, view.guildId) } : {}),
        })],
      },
    };
  }
  const picked = values[0];
  if (values.length !== 1 || typeof picked !== "string") return reply(INVALID);
  let note: string;
  if (parts[1] === "k") {
    const kind = resolveKind(view.type, picked);
    if (!kind.ok) return reply(INVALID);
    if ((await updateContentSettings(deps.sql, id, { kind: kind.value })) !== "ok") return reply(NOT_OPEN);
    note = `✅ Category set to ${kindsOf(view.type).find((k) => k.id === kind.value)?.label ?? kind.value}.`;
  } else if (parts[1] === "l" && (picked === "1" || picked === "0")) {
    if ((await updateContentSettings(deps.sql, id, { hasLoot: picked === "1" })) !== "ok") return reply(NOT_OPEN);
    note = `✅ Loot vote ${picked === "1" ? "on" : "off"}.`;
  } else {
    return reply(INVALID);
  }
  await applied(deps, view);
  const fresh = await getRosterView(deps.sql, id, deps.now());
  return { type: UPDATE_MESSAGE, data: editPanel(fresh ?? view, note) };
}

// edb:<content>: the Build link form. A link sets the reference, an empty field removes it (FR-031).
export async function handleBuildLinkModal(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const raw = (i.data as { custom_id?: unknown } | undefined)?.custom_id;
  const parts = typeof raw === "string" ? raw.split(":") : [];
  if (parts.length !== 2 || parts[0] !== "edb" || !UUID.test(parts[1]!) || !i.guild_id) return reply(INVALID);
  const checked = await authorize(deps, i, await getManageTargetById(deps.sql, parts[1]!));
  if (!checked.ok) return checked.response;
  const text = (modalValues(i).link ?? "").trim();
  let ref: string | null = null;
  if (text) {
    const parsed = parseBuildReference(text, i.guild_id);
    if (!parsed.ok) return reply(parsed.error);
    ref = parsed.value;
  }
  if ((await updateContentSettings(deps.sql, parts[1]!, { buildRef: ref })) !== "ok") return reply(NOT_OPEN);
  const view = await getRosterView(deps.sql, parts[1]!, deps.now());
  if (view) await applied(deps, view);
  return reply(ref ? "✅ Build link saved." : "✅ Build link removed.");
}
