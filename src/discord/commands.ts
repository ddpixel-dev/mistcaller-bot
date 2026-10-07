import { USER_AGENT } from "./rest.ts";
import { kindChoices } from "../domain/kinds.ts";

const kindOption = (description: string): CommandOption => ({
  type: 3, name: "kind", description, required: false, choices: kindChoices(),
});

export type CommandOption = {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  options?: CommandOption[];
  choices?: { name: string; value: string }[];
  channel_types?: number[];
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
        description: "Create a content signup in this forum post",
        options: [
          { type: 5, name: "loot-vote", description: "Run a split-or-regear loot vote for this content?", required: false },
          kindOption("Kind of content (defaults to Other)"),
        ],
      },
      {
        type: 1,
        name: "edit",
        description: "Edit this post's content in a form (creator, officers, Manage Server)",
        options: [
          { type: 5, name: "loot-vote", description: "Turn the loot vote on or off (leave empty to keep it)", required: false },
          kindOption("Change the kind of content (leave empty to keep it)"),
        ],
      },
      {
        type: 1,
        name: "setup",
        description: "Set the officer role and the content forums (Manage Server)",
        options: [
          { type: 8, name: "officer-role", description: "Role allowed to manage any content", required: false },
          { type: 7, name: "pvp-forum", description: "Forum for PvP content", required: false, channel_types: [15] },
          { type: 7, name: "pve-forum", description: "Forum for PvE content", required: false, channel_types: [15] },
          {
            type: 4, name: "daily-cap", description: "Contents one member may create per day (default 5)",
            required: false, min_value: 1, max_value: 50,
          },
        ],
      },
      { type: 1, name: "cancel", description: "Cancel this post's content (creator, officers, Manage Server)" },
    ],
  },
] satisfies Command[] as [Command & { options: (CommandOption & { options?: CommandOption[] })[] }];

export function buildRegisterRequest(a: { appId: string; guildId: string; token: string }): {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
} {
  return {
    url: `https://discord.com/api/v10/applications/${a.appId}/guilds/${a.guildId}/commands`,
    init: {
      method: "PUT",
      headers: { Authorization: `Bot ${a.token}`, "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify(commands),
    },
  };
}
