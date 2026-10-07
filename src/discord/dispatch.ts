import type { Sql } from "../db/client.ts";
import type { Rest } from "./rest.ts";
import type { Dispatch, Interaction, InteractionResponse } from "./types.ts";
import { reply } from "./response.ts";
import { handleCreateModal } from "../handlers/create.ts";
import { handleCreateCancel, handleCreateContinue, handleCreatePanel } from "../handlers/create-panel.ts";
import { handleMeComponent } from "../handlers/me.ts";
import { handleAttendanceComponent } from "../handlers/attendance.ts";
import { handleGuidedComponent, handleGuidedModal } from "../handlers/guided.ts";
import { handleContentCommand } from "../handlers/content.ts";
import { handleAutocomplete } from "../handlers/preset.ts";
import { handleCancelButton, handleEditModal } from "../handlers/manage.ts";
import { handleJoin, handleLeave, handleLeaveSlot, handleOldRosterControl, handleWait } from "../handlers/signup.ts";
import { handleVote } from "../handlers/vote.ts";

export type Deps = { sql: Sql; rest: Rest; now: () => Date };
export type Handler = (deps: Deps, i: Interaction) => Promise<InteractionResponse>;

// Routing tables. Later tasks add entries here (signup:, leave:, vote: ...).
const commandHandlers: Record<string, Handler> = { content: handleContentCommand };
const modalHandlers: Record<string, Handler> = { create: handleCreateModal, edit: handleEditModal, gsc: handleGuidedModal };
const componentHandlers: Record<string, Handler> = {
  join: handleJoin, wait: handleWait, leaveslot: handleLeaveSlot, leave: handleLeave, signup: handleOldRosterControl, pick: handleOldRosterControl, vote: handleVote, cancelyes: handleCancelButton, cancelno: handleCancelButton,
  cp: handleCreatePanel, cpgo: handleCreateContinue, cpx: handleCreateCancel, gs: handleGuidedComponent, me: handleMeComponent, att: handleAttendanceComponent,
};

const NOT_IMPLEMENTED = () => reply("Not implemented yet");

export function createDispatch(deps: Deps): Dispatch {
  return async (i) => {
    const data = (i.data ?? {}) as { name?: unknown; custom_id?: unknown };
    let handler: Handler | undefined;
    if (i.type === 4) return await handleAutocomplete(deps, i);
    if (i.type === 2 && typeof data.name === "string") {
      handler = Object.hasOwn(commandHandlers, data.name) ? commandHandlers[data.name] : undefined;
    } else if ((i.type === 3 || i.type === 5) && typeof data.custom_id === "string") {
      const prefix = data.custom_id.split(":")[0]!;
      const table = i.type === 5 ? modalHandlers : componentHandlers;
      handler = Object.hasOwn(table, prefix) ? table[prefix] : undefined;
    }
    return handler ? await handler(deps, i) : NOT_IMPLEMENTED();
  };
}
