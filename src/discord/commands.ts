import { USER_AGENT } from "./rest.ts";

export type CommandOption = { type: number; name: string; description: string; required?: boolean; options?: CommandOption[] };
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
          { type: 5, name: "loot", description: "Is loot shared for this content?", required: false },
        ],
      },
      {
        type: 1,
        name: "edit",
        description: "Edit this post's content (creator, officers, Manage Server)",
        options: [
          { type: 5, name: "loot", description: "Change whether loot is shared (leave empty to keep it)", required: false },
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
