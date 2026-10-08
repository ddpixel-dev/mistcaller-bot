---
title: Adding the bot to a server
type: guide
status: active
date: 2026-10-08
---

# Adding the bot to a server

The bot works in any server it is a member of. Content, settings and admin roles are kept per server.

## One-time, in the Developer Portal (the application owner)
1. **Installation:** turn **Guild Install** on. User Install is not needed (the commands are server-only, ADR 0022).
2. Default install settings for Guild Install: scopes `bot` and `applications.commands`; permissions View Channel, Send Messages, Send Messages in Threads, Read Message History, Use External Emoji.
3. **Bot:** turn **Public Bot** on while other people need to add it (a server owner can then add it with the link). Turn it off again afterwards to stop strangers adding it; servers that already have it keep it.
4. Register the commands once: `docker compose run --rm node npm run register`.

## For each server (the server owner, or anyone with Manage Server)
1. Open the invite link: `https://discord.com/oauth2/authorize?client_id=<DISCORD_APP_ID>&scope=bot+applications.commands&permissions=274878237696`.
2. Choose **Add to server** (not "Add to my apps"), pick the server, authorise.
3. The bot appears in the member list with its own role. To limit it to some channels, edit that role's channel permissions (View Channel, Send Messages, Send Messages in Threads).
4. Run `/content setup` and pick the roles that can manage content. Without it, only the content's creator and members with Manage Server can manage content.

## If creating content fails
The bot now says why: it is not added to the server (only to an account), or it cannot post in that channel. To check where the bot really is, list its servers with its token: `GET /users/@me/guilds`.

## Removing the bot
- **From a server:** right-click the bot in the member list and choose Kick, or Server Settings, Integrations, the bot, Remove.
- **An account install:** User Settings, Authorized Apps, find the app and remove it.
