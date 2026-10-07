import type { Deps } from "../discord/dispatch.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import { reply } from "../discord/response.ts";
import { commandPath, focusedOption, leafOption } from "../discord/modal.ts";
import { getGuildSettings } from "../db/settings.ts";
import { getRosterView } from "../db/content.ts";
import { getManageTarget } from "../db/manage.ts";
import { MAX_PRESETS, deletePreset, listPresets, savePreset, searchPresetNames } from "../db/preset.ts";
import { canManagePresets } from "../domain/permissions.ts";
import { parsePresetName } from "../domain/presets.ts";
import { escapeText } from "../render/roster.ts";

const NOT_ALLOWED = "Only members with Manage Server or the officer role can manage presets.";

async function mayManage(deps: Deps, i: Interaction): Promise<boolean> {
  const userId = i.member?.user?.id;
  if (!i.guild_id || !userId) return false;
  const settings = await getGuildSettings(deps.sql, i.guild_id);
  return canManagePresets(
    { userId, roles: i.member?.roles ?? [], permissions: i.member?.permissions },
    settings?.officerRoleId ?? null,
  );
}

export async function handlePresetCommand(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const guildId = i.guild_id;
  const userId = i.member?.user?.id;
  if (!guildId || !userId) return reply("Use this command inside the server.");
  const action = commandPath(i)[1];

  if (action === "list") {
    const presets = await listPresets(deps.sql, guildId);
    if (presets.length === 0) return reply("No presets saved yet. An officer can save one with `/content preset save`.");
    const lines = presets.map((p) => `• ${escapeText(p.name)} (${p.slots.length} slots)`);
    return reply(`Saved presets (${presets.length}/${MAX_PRESETS}):\n${lines.join("\n")}`);
  }

  if (action !== "save" && action !== "delete") return reply("Not implemented yet");
  if (!(await mayManage(deps, i))) return reply(NOT_ALLOWED);
  const rawName = leafOption(i, "name");
  const name = parsePresetName(typeof rawName === "string" ? rawName : "");
  if (!name.ok) return reply(name.error);

  if (action === "delete") {
    return reply((await deletePreset(deps.sql, guildId, name.value)) ? "Preset deleted." : "There is no preset with that name.");
  }

  const target = i.channel?.id ? await getManageTarget(deps.sql, guildId, i.channel.id) : null;
  const view = target ? await getRosterView(deps.sql, target.id, deps.now()) : null;
  if (!view) return reply("Run this inside a post that has content. Its slots are what gets saved.");
  const result = await savePreset(deps.sql, {
    guildId, name: name.value, slots: view.slots.map((s) => ({ role: s.role, weapon: s.weapon })), createdBy: userId,
  });
  if (result === "exists") return reply("A preset with that name already exists. Pick another name or delete it first.");
  if (result === "full") return reply(`This server already has ${MAX_PRESETS} presets. Delete one first.`);
  return reply(`Preset "${escapeText(name.value)}" saved with ${view.slots.length} slots.`);
}

// Autocomplete for the preset names (create's preset option and preset delete).
export async function handleAutocomplete(deps: Deps, i: Interaction): Promise<InteractionResponse> {
  const focused = focusedOption(i);
  const isPresetField = focused && (focused.name === "preset" || (focused.name === "name" && commandPath(i)[1] === "delete"));
  const names = i.guild_id && isPresetField ? await searchPresetNames(deps.sql, i.guild_id, focused.value) : [];
  return { type: 8, data: { choices: names.map((n) => ({ name: n, value: n })) } };
}
