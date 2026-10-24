import type { Deps } from "../../src/discord/dispatch.ts";
import type { Dispatch, Interaction } from "../../src/discord/types.ts";
import { subcommandName } from "../../src/discord/modal.ts";
import { handleCancel, handleLock, handleUnlock, openEditForm } from "../../src/handlers/manage.ts";
import { handleAttendance, handleEnd, handleReopen } from "../../src/handlers/attendance.ts";

// The host's commands were removed (ADR 0029): the same handlers now run from the Manage panel, whose routing is tested
// in manage-panel.test.ts. Tests of their rules still build a command-shaped interaction; this sends it straight to
// the handler and everything else to the real dispatch.
const HOST = { edit: openEditForm, cancel: handleCancel, lock: handleLock, unlock: handleUnlock, end: handleEnd, reopen: handleReopen, attendance: handleAttendance };

export function withHostActions(d: Dispatch, deps: Deps): Dispatch {
  return async (i: Interaction) => {
    const sub = i.type === 2 ? subcommandName(i) : null;
    return sub && Object.hasOwn(HOST, sub) ? await HOST[sub as keyof typeof HOST](deps, i) : await d(i);
  };
}
