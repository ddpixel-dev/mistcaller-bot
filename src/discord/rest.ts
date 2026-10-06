const API = "https://discord.com/api/v10";
export const USER_AGENT = "DiscordBot (content-roster-bot, 0.1.0)";
const MAX_RETRY_WAIT_MS = 2000;

export class DiscordApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DiscordApiError";
    this.status = status;
  }
}

export type Rest = {
  createMessage(channelId: string, body: unknown): Promise<{ id: string }>;
  editMessage(channelId: string, messageId: string, body: unknown): Promise<void>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
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
      throw new DiscordApiError(res.status, `Discord API ${method} ${path} failed with status ${res.status}`);
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
  };
}
