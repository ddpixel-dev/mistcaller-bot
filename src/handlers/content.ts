import { handleStatsCommand } from "./stats.ts";
import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { reply } from "../discord/response.ts";
import { subcommandName } from "../discord/modal.ts";
import { handleCreateCommand } from "./create.ts";
import { handleHelpCommand } from "./help.ts";
import { handleSetupCommand } from "./setup.ts";
import { handlePresetCommand } from "./preset.ts";
import { handleWeaponCommand } from "./weapon.ts";
import { handleMeCommand } from "./me.ts";
import { handleSlotCommand } from "./guided.ts";
import { handleListCommand } from "./manage.ts";
import { handleHistoryCommand } from "./attendance.ts";

// The host's actions (edit, lock, unlock, end, reopen, cancel, attendance, duty, add player) are buttons of the
// Manage panel on the roster, not commands (ADR 0029).
export async function handleContentCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  switch (subcommandName(i)) {
    case "create": return await handleCreateCommand(deps, i);
    case "setup": return await handleSetupCommand(deps, i);
    case "preset": return await handlePresetCommand(deps, i);
    case "weapon": return await handleWeaponCommand(deps, i);
    case "me": return await handleMeCommand(deps, i);
    case "slot": return await handleSlotCommand(deps, i);
    case "list": return await handleListCommand(deps, i);
    case "help": return await handleHelpCommand(deps, i);
    case "history": return await handleHistoryCommand(deps, i);
    case "stats": return await handleStatsCommand(deps, i);
    default: return reply("That command no longer exists. Press **Manage** on the roster for the host's actions.");
  }
}
