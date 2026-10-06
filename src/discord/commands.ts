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
    ],
  },
] satisfies Command[] as [Command & { options: [CommandOption & { options: CommandOption[] }] }];

export function buildRegisterRequest(a: { appId: string; guildId: string; token: string }): {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
} {
  return {
    url: `https://discord.com/api/v10/applications/${a.appId}/guilds/${a.guildId}/commands`,
    init: {
      method: "PUT",
      headers: { Authorization: `Bot ${a.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
    },
  };
}
