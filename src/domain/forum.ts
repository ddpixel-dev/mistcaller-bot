import type { GuildSettings } from "../db/settings.ts";
import type { ContentType } from "./types.ts";

export function forumContentType(s: GuildSettings, parentId: string | null): ContentType | null {
  if (parentId === null) return null;
  if (parentId === s.pvpForumId) return "pvp";
  if (parentId === s.pveForumId) return "pve";
  return null;
}
