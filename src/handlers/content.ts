import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { reply } from "../discord/response.ts";
import { subcommandName } from "../discord/modal.ts";
import { handleCreateCommand } from "./create.ts";
import { handleCancelCommand, handleEditCommand } from "./manage.ts";
import { handleAssignCommand } from "./fill.ts";
import { handleHelpCommand } from "./help.ts";
import { handleSetupCommand } from "./setup.ts";
import { handlePresetCommand } from "./preset.ts";
import { handleWeaponCommand } from "./weapon.ts";
import { handleMeCommand } from "./me.ts";
import { handleDutyCommand } from "./duty.ts";
import { handleSlotCommand } from "./guided.ts";
import { handleListCommand, handleLockCommand, handleUnlockCommand } from "./manage.ts";
import { handleAttendanceCommand, handleEndCommand, handleHistoryCommand, handleReopenCommand } from "./attendance.ts";

export async function handleContentCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  switch (subcommandName(i)) {
    case "create": return await handleCreateCommand(deps, i);
    case "edit": return await handleEditCommand(deps, i);
    case "cancel": return await handleCancelCommand(deps, i);
    case "setup": return await handleSetupCommand(deps, i);
    case "preset": return await handlePresetCommand(deps, i);
    case "weapon": return await handleWeaponCommand(deps, i);
    case "me": return await handleMeCommand(deps, i);
    case "duty": return await handleDutyCommand(deps, i);
    case "slot": return await handleSlotCommand(deps, i);
    case "end": return await handleEndCommand(deps, i);
    case "reopen": return await handleReopenCommand(deps, i);
    case "lock": return await handleLockCommand(deps, i);
    case "unlock": return await handleUnlockCommand(deps, i);
    case "list": return await handleListCommand(deps, i);
    case "attendance": return await handleAttendanceCommand(deps, i);
    case "assign": return await handleAssignCommand(deps, i);
    case "help": return await handleHelpCommand(deps, i);
    case "history": return await handleHistoryCommand(deps, i);
    default: return reply("Not implemented yet");
  }
}
