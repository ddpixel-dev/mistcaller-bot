const API = "https://discord.com/api/v10";
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
};

export function createRest(token: string, fetchFn: typeof fetch = fetch): Rest {
  async function call(method: string, path: string, body: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
    let res = await fetchFn(`${API}${path}`, init);
    if (res.status === 429) {
      const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
      const wait = Math.min(Math.max(Number(data.retry_after) || 0, 0) * 1000, MAX_RETRY_WAIT_MS);
      await new Promise((r) => setTimeout(r, wait));
      res = await fetchFn(`${API}${path}`, init);
    }
    if (!res.ok) {
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
  };
}
