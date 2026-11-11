import type { Sql } from "../db/client.ts";
import type { Rest } from "./rest.ts";
import type { Dispatch, Interaction, InteractionResponse } from "./types.ts";
import { NOT_VALID, reply } from "./response.ts";
import { handleCreateModal } from "../handlers/create.ts";
import { handleBlankForm, handleCardBuild, handleCardComponent, handleCardDetails, handleCardParty2, handleCardSavePreset, handleLauncher, handleOldCreate } from "../handlers/card.ts";
import { handleHub } from "../handlers/hub.ts";
import { handleMeComponent } from "../handlers/me.ts";
import { handleSetupComponent } from "../handlers/setup.ts";
import { handleAssignComponent } from "../handlers/fill.ts";
import { handleWeaponPick } from "../handlers/weapon-pick.ts";
import { handleAttendanceComponent } from "../handlers/attendance.ts";
import { handlePing } from "../handlers/ping.ts";
import { handleGuidedComponent, handleGuidedModal } from "../handlers/guided.ts";
import { handleContentCommand } from "../handlers/content.ts";
import { handleCancelButton, handleEditModal, handleParty2Modal } from "../handlers/manage.ts";
import { handleFillChoice } from "../handlers/fill-pref.ts";
import { handleJoin, handleLeave, handleLeaveSlot, handleOldRosterControl, handleTentative, handleWait } from "../handlers/signup.ts";
import { handleVote } from "../handlers/vote.ts";
import { handleRetryComponent } from "../handlers/retry.ts";
import { handleRemoveComponent } from "../handlers/remove.ts";
import { handleBuildLinkModal, handleEditPanelComponent, handleManageComponent } from "../handlers/manage-panel.ts";
import { handleSetWeaponComponent } from "../handlers/set-weapon.ts";
import { handleDutyComponent } from "../handlers/duty.ts";
import { splitParty } from "../domain/parties.ts";

export type Deps = { sql: Sql; rest: Rest; now: () => Date };
export type Handler = (deps: Deps, i: Interaction) => Promise<InteractionResponse>;

// Routing tables. Later tasks add entries here (signup:, leave:, vote: ...).
const commandHandlers: Record<string, Handler> = { content: handleContentCommand };
const modalHandlers: Record<string, Handler> = { create: handleCreateModal, cf: handleOldCreate, ccd: handleCardDetails, ccs2: handleCardParty2, ccb: handleCardBuild, ccp: handleCardSavePreset, ccl: handleBlankForm, edit: handleEditModal, edp: handleParty2Modal, gsc: handleGuidedModal, edb: handleBuildLinkModal };
const componentHandlers: Record<string, Handler> = {
  join: handleJoin, wait: handleWait, fp: handleFillChoice, leaveslot: handleLeaveSlot, leave: handleLeave, tent: handleTentative, signup: handleOldRosterControl, pick: handleOldRosterControl, vote: handleVote, cancelyes: handleCancelButton, cancelno: handleCancelButton,
  cp: handleOldCreate, cpgo: handleOldCreate, cpx: handleOldCreate, cc: handleCardComponent, lc: handleLauncher, hub: handleHub, gs: handleGuidedComponent, me: handleMeComponent, att: handleAttendanceComponent, ping: handlePing, setup: handleSetupComponent, fa: handleAssignComponent, wp: handleWeaponPick, rt: handleRetryComponent, rm: handleRemoveComponent, mg: handleManageComponent, dt: handleDutyComponent, ed: handleEditPanelComponent, sw: handleSetWeaponComponent,
};

// The roster controls and host panels that carry a party suffix (FR-070). Other custom ids are never touched.
const PARTY_CONTROLS = new Set(["join", "wait", "fp", "leave", "leaveslot", "tent", "me", "fa", "rm", "dt", "sw", "att"]);

const NOT_IMPLEMENTED = () => reply("Not implemented yet");

export function createDispatch(deps: Deps): Dispatch {
  return async (i) => {
    const data = (i.data ?? {}) as { name?: unknown; custom_id?: unknown };
    let handler: Handler | undefined;
    if (i.type === 2 && typeof data.name === "string") {
      handler = Object.hasOwn(commandHandlers, data.name) ? commandHandlers[data.name] : undefined;
    } else if ((i.type === 3 || i.type === 5) && typeof data.custom_id === "string") {
      const prefix = data.custom_id.split(":")[0]!;
      if (i.type === 3 && PARTY_CONTROLS.has(prefix)) {
        const split = splitParty(data.custom_id);
        if (!split) return reply(NOT_VALID);
        (data as { custom_id: string }).custom_id = split.id;
        i.party = split.party;
      }
      const table = i.type === 5 ? modalHandlers : componentHandlers;
      handler = Object.hasOwn(table, prefix) ? table[prefix] : undefined;
    }
    return handler ? await handler(deps, i) : NOT_IMPLEMENTED();
  };
}
