import { USER_AGENT } from "./rest.ts";
import { kindChoices } from "../domain/kinds.ts";
import { CLEAR_DUTY, DUTIES, DUTY_WORD } from "../domain/duties.ts";
import { GUIDED_ROLES } from "../domain/guided.ts";

const kindOption = (description: string): CommandOption => ({
  type: 3, name: "category", description, required: false, choices: kindChoices(),
});

export type CommandOption = {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  options?: CommandOption[];
  choices?: { name: string; value: string }[];
  channel_types?: number[];
  autocomplete?: boolean;
  max_length?: number;
  min_value?: number;
  max_value?: number;
};
export type Command = { name: string; description: string; options: CommandOption[] };

export const commands = [
  {
    name: "content",
    description: "Guild content signups",
    options: [
      {
        type: 1,
        name: "create",
        description: "Create a content signup in this channel or post",
      },
      {
        type: 1,
        name: "edit",
        description: "Edit this post's content in a form (creator, admin roles, Manage Server)",
        options: [
          { type: 5, name: "loot-vote", description: "Turn the loot vote on or off (leave empty to keep it)", required: false },
          kindOption("Change the category (leave empty to keep it)"),
        ],
      },
      { type: 1, name: "setup", description: "Choose the admin roles that can manage content (Manage Server)" },
      {
        type: 2,
        name: "preset",
        description: "Saved slot presets (save and delete: Manage Server or an admin role)",
        options: [
          {
            type: 1, name: "save", description: "Save this post's slots as a preset",
            options: [{ type: 3, name: "name", description: "Preset name", required: true, max_length: 50 }],
          },
      { type: 1, name: "list", description: "Show the saved presets" },
          {
            type: 1, name: "delete", description: "Delete a preset",
            options: [{ type: 3, name: "name", description: "Preset name", required: true, autocomplete: true }],
          },
        ],
      },
      {
        type: 1,
        name: "weapon",
        description: "Find a weapon and see its icon",
        options: [{
          type: 3, name: "name", description: "Part of the weapon name", required: true,
          autocomplete: true, max_length: 50,
        }],
      },
      { type: 1, name: "me", description: "Your own place in this content: sign up, move or leave" },
      {
        type: 1,
        name: "duty",
        description: `Give a player a ${DUTY_WORD.toLowerCase()} (creator, admin roles, Manage Server)`,
        options: [
          {
            type: 4, name: "position", description: "Position number on the roster", required: true,
            min_value: 1, max_value: 20,
          },
          {
            type: 3, name: "duty", description: `The ${DUTY_WORD.toLowerCase()} to give`, required: true,
            choices: [...DUTIES.map((d) => ({ name: d.label, value: d.id })), { name: "Clear", value: CLEAR_DUTY }],
          },
        ],
      },
      {
        type: 1,
        name: "slot",
        description: "Guided slots: fill the current slot (role, weapon with search, duty)",
        options: [
          {
            type: 3, name: "role", description: "The slot's role", required: true,
            choices: GUIDED_ROLES.map((r) => ({ name: r, value: r })),
          },
          {
            type: 3, name: "weapon", description: "Type part of the weapon name and pick it", required: true,
            autocomplete: true, max_length: 50,
          },
          {
            type: 3, name: "duty", description: `The slot's ${DUTY_WORD.toLowerCase()} (optional)`, required: false,
            choices: DUTIES.map((d) => ({ name: d.label, value: d.id })),
          },
        ],
      },
      { type: 1, name: "lock", description: "Close signups now (creator, admin roles, Manage Server)" },
      { type: 1, name: "unlock", description: "Reopen signups after a lock, before the start (creator, admin roles, Manage Server)" },
      { type: 1, name: "list", description: "Upcoming content in this server, with links" },
      { type: 1, name: "end", description: "End this content once it has started (creator, admin roles, Manage Server)" },
      { type: 1, name: "attendance", description: "Open the attendance form privately (creator, admin roles, Manage Server)" },
      {
        type: 1,
        name: "history",
        description: "A member's attendance history",
        options: [{ type: 6, name: "member", description: "The member", required: true }],
      },
      { type: 1, name: "cancel", description: "Cancel this post's content (creator, admin roles, Manage Server)" },
    ],
  },
] satisfies Command[] as [Command & { options: (CommandOption & { options?: CommandOption[] })[] }];

type RegisterRequest = { url: string; init: { method: string; headers: Record<string, string>; body: string } };

const headers = (token: string) => ({ Authorization: `Bot ${token}`, "Content-Type": "application/json", "User-Agent": USER_AGENT });

// Global registration (ADR 0020): the commands exist in every server the bot is in, so no server id is needed.
export function buildRegisterRequest(a: { appId: string; token: string }): RegisterRequest {
  return {
    url: `https://discord.com/api/v10/applications/${a.appId}/commands`,
    init: { method: "PUT", headers: headers(a.token), body: JSON.stringify(commands) },
  };
}

// One-time cleanup: commands registered to a single server before ADR 0020 would show up twice next to the global ones.
export function buildClearGuildRequest(a: { appId: string; guildId: string; token: string }): RegisterRequest {
  return {
    url: `https://discord.com/api/v10/applications/${a.appId}/guilds/${a.guildId}/commands`,
    init: { method: "PUT", headers: headers(a.token), body: "[]" },
  };
}
