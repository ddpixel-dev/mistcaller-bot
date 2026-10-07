import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { reply } from "../discord/response.ts";
import { subcommandName } from "../discord/modal.ts";
import { handleCreateCommand } from "./create.ts";
import { handleCancelCommand, handleEditCommand } from "./manage.ts";
import { handleSetupCommand } from "./setup.ts";
import { handlePresetCommand } from "./preset.ts";
import { handleWeaponCommand } from "./weapon.ts";
import { handleMeCommand } from "./me.ts";
import { handleDutyCommand } from "./duty.ts";

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
    default: return reply("Not implemented yet");
  }
}
