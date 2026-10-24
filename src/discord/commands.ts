import { USER_AGENT } from "./rest.ts";

const buildReferenceOption = (): CommandOption => ({
  type: 3, name: "build-reference", description: "A link to the build: a channel, post or message of this server (optional)",
  required: false, max_length: 200,
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
// Server-only commands (ADR 0022): integration type 0 is a server install and context 0 is a server channel, so the
// commands never show where the bot is not a member (an account install, direct messages).
export type Command = { name: string; description: string; options: CommandOption[]; integration_types?: number[]; contexts?: number[] };

export const commands = [
  {
    name: "content",
    description: "Guild content signups",
    integration_types: [0],
    contexts: [0],
    options: [
      {
        type: 1,
        name: "create",
        description: "Create a content signup in this channel or post",
        options: [buildReferenceOption()],
      },
      {
        type: 1, name: "setup", description: "Admin roles (Manage Server); the Events Calendar channel and event forums (admins)",
        options: [
          { type: 7, name: "calendar-channel", description: "The channel where the bot keeps the Events Calendar of live and upcoming events", required: false, channel_types: [0, 5] },
          { type: 5, name: "clear-calendar", description: "Stop keeping the Events Calendar and remove its messages", required: false },
          { type: 7, name: "event-forum", description: "A forum where the bot makes each event's post from a pinned Create event post", required: false, channel_types: [15] },
          {
            type: 3, name: "forum-type", description: "With event-forum: the content types it takes (default Any)", required: false,
            choices: [{ name: "Any", value: "any" }, { name: "PvP", value: "pvp" }, { name: "PvE", value: "pve" }],
          },
          { type: 7, name: "clear-event-forum", description: "Stop using a forum for events and remove its Create event post", required: false, channel_types: [15] },
        ],
      },
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
      { type: 1, name: "me", description: "Your own place in this content: sign up, move or leave" },
      { type: 1, name: "list", description: "Live and upcoming content in this server, with links" },
      { type: 1, name: "stats", description: "This server's statistics, shown only to you" },
      {
        type: 1,
        name: "history",
        description: "A member's attendance history (your own for everyone; others: admins only)",
        options: [{ type: 6, name: "member", description: "The member", required: true }],
      },
      { type: 1, name: "help", description: "What the bot does and every command" },
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
