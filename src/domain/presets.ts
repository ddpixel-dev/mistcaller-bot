import type { Result } from "./types.ts";

export function parsePresetName(input: string): Result<string> {
  const name = input.replace(/[\u0000-\u001F\u007F​-‍⁠﻿]/g, "").trim();
  if (name.length === 0) return { ok: false, error: "The preset needs a name." };
  if (name.length > 50) return { ok: false, error: "The preset name is too long (max 50 characters)." };
  return { ok: true, value: name };
}
