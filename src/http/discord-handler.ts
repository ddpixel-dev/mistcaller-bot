import { createPublicKey, verify } from "node:crypto";
import type { Dispatch, Interaction } from "../discord/types.ts";
import { PONG } from "../discord/response.ts";

const SPKI_PREFIX = "302a300506032b6570032100";

export function verifySignature(
  rawBody: string,
  signatureHex: string,
  timestamp: string,
  publicKeyHex: string,
): boolean {
  try {
    if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) return false;
    if (!/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
    const key = createPublicKey({
      key: Buffer.from(SPKI_PREFIX + publicKeyHex, "hex"),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

export function isFresh(timestamp: string, now: Date, windowSeconds = 300): boolean {
  if (!/^\d+$/.test(timestamp)) return false;
  return Math.abs(now.getTime() / 1000 - Number(timestamp)) <= windowSeconds;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function handleDiscordRequest(
  req: Request,
  opts: { publicKey: string; dispatch: Dispatch; now?: () => Date },
): Promise<Response> {
  const started = Date.now();
  const raw = await req.text();
  const sig = req.headers.get("x-signature-ed25519");
  const timestamp = req.headers.get("x-signature-timestamp");
  const now = (opts.now ?? (() => new Date()))();
  if (!sig || !timestamp) return new Response("invalid request signature", { status: 401 });
  if (!verifySignature(raw, sig, timestamp, opts.publicKey) || !isFresh(timestamp, now)) {
    return new Response("invalid request signature", { status: 401 });
  }
  let interaction: Interaction;
  try {
    interaction = JSON.parse(raw) as Interaction;
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (interaction === null || typeof interaction !== "object") {
    return new Response("bad request", { status: 400 });
  }
  const result =
    interaction.type === 1 ? { type: PONG } : await opts.dispatch(interaction);
  console.log(
    JSON.stringify({ evt: "interaction", type: interaction.type, ms: Date.now() - started }),
  );
  return json(200, result);
}
