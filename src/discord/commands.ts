import { USER_AGENT } from "./rest.ts";

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
        type: 1, name: "setup", description: "Admin roles (Manage Server); the Events Calendar, changelog channel and event forums (admins)",
        options: [
          { type: 7, name: "calendar-channel", description: "The channel where the bot keeps the Events Calendar of live and upcoming events", required: false, channel_types: [0, 5] },
          { type: 5, name: "clear-calendar", description: "Stop keeping the Events Calendar and remove its messages", required: false },
          { type: 7, name: "event-forum", description: "A forum where the bot posts normal events of one type (use with forum-type)", required: false, channel_types: [15] },
          {
            type: 3, name: "forum-type", description: "With event-forum: the type this forum is for. Repeat to use one forum for several", required: false,
            choices: [{ name: "PvP", value: "pvp" }, { name: "PvE", value: "pve" }, { name: "PvX", value: "pvx" }],
          },
          { type: 7, name: "changelog-channel", description: "Where changelogs go: a channel, a forum (a post per release), or one thread or forum post", required: false, channel_types: [0, 5, 10, 11, 12, 15] },
          { type: 5, name: "clear-changelog", description: "Stop posting changelogs in this server", required: false },
          { type: 7, name: "cta-channel", description: "The text channel where each CTA (call to arms) is announced, with a thread for its roster", required: false, channel_types: [0, 5] },
          { type: 8, name: "cta-role", description: "Add a role that may schedule a CTA (admins always may); repeat for more roles", required: false },
          { type: 8, name: "remove-cta-role", description: "Remove a role from those that may schedule a CTA", required: false },
          { type: 5, name: "clear-cta", description: "Stop using a CTA channel (CTAs cannot be scheduled)", required: false },
          { type: 7, name: "clear-event-forum", description: "Stop using a forum for events (with forum-type: only that type)", required: false, channel_types: [15] },
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
