const API = "https://discord.com/api/v10";
export const USER_AGENT = "DiscordBot (content-roster-bot, 0.1.0)";
const MAX_RETRY_WAIT_MS = 2000;

export class DiscordApiError extends Error {
  status: number;
  code: number | undefined;
  detail: string | undefined;
  constructor(status: number, message: string, code?: number, detail?: string) {
    super(message);
    this.name = "DiscordApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export type Rest = {
  createMessage(channelId: string, body: unknown): Promise<{ id: string }>;
  editMessage(channelId: string, messageId: string, body: unknown): Promise<void>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  // Optional so older test doubles keep working; the real client has both.
  createDm?(userId: string): Promise<string>;
  memberName?(guildId: string, userId: string): Promise<string | null>;
};

export const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createRest(
  token: string,
  fetchFn: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = realSleep,
): Rest {
  async function call(method: string, path: string, body: unknown, okStatuses: number[] = []): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", "User-Agent": USER_AGENT },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    let res = await fetchFn(`${API}${path}`, init);
    if (res.status === 429) {
      const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
      const wait = Math.min(Math.max(Number(data.retry_after) || 0, 0) * 1000, MAX_RETRY_WAIT_MS);
      await sleep(wait);
      res = await fetchFn(`${API}${path}`, init);
    }
    if (!res.ok && !okStatuses.includes(res.status)) {
      // Discord's own reason ("Invalid emoji", ...) is safe to keep; it never contains the token.
      const body = (await res.json().catch(() => ({}))) as { code?: unknown; message?: unknown; errors?: unknown };
      const code = typeof body.code === "number" ? body.code : undefined;
      const text = typeof body.message === "string" ? body.message : undefined;
      const where = body.errors ? ` ${JSON.stringify(body.errors)}` : "";
      throw new DiscordApiError(
        res.status,
        `Discord API ${method} ${path} failed with status ${res.status}`,
        code,
        text ? `${text}${where}`.slice(0, 400) : undefined,
      );
    }
    return await res.json().catch(() => ({}));
  }

  return {
    async createMessage(channelId, body) {
      const out = (await call("POST", `/channels/${channelId}/messages`, body)) as { id: string };
      return { id: out.id };
    },
    async editMessage(channelId, messageId, body) {
      await call("PATCH", `/channels/${channelId}/messages/${messageId}`, body);
    },
    async deleteMessage(channelId, messageId) {
      await call("DELETE", `/channels/${channelId}/messages/${messageId}`, undefined, [404]);
    },
    // A direct message channel with a member: the only way to message someone privately without a click.
    async createDm(userId) {
      const out = (await call("POST", "/users/@me/channels", { recipient_id: userId })) as { id: string };
      return out.id;
    },
    // The name shown in the server: nickname, then display name, then username. Null when unavailable.
    async memberName(guildId, userId) {
      try {
        const m = (await call("GET", `/guilds/${guildId}/members/${userId}`, undefined)) as {
          nick?: string | null; user?: { global_name?: string | null; username?: string };
        };
        return m.nick || m.user?.global_name || m.user?.username || null;
      } catch {
        return null;
      }
    },
  };
}
