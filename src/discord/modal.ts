import type { Interaction } from "./types.ts";

export function textInput(
  custom_id: string,
  label: string,
  max_length: number,
  extra: Record<string, unknown> = {},
) {
  return {
    type: 1,
    components: [{ type: 4, custom_id, label, style: 1, max_length, required: true, ...extra }],
  };
}

export function modalValues(i: Interaction): Record<string, string> {
  const rows = ((i.data as { components?: unknown[] } | undefined)?.components ?? []) as {
    components?: { custom_id?: string; value?: string }[];
  }[];
  const out: Record<string, string> = {};
  for (const row of rows) {
    const c = row.components?.[0];
    if (c && typeof c.custom_id === "string") out[c.custom_id] = typeof c.value === "string" ? c.value : "";
  }
  return out;
}

export function subcommandName(i: Interaction): string | null {
  const data = i.data as { options?: { name?: unknown }[] } | undefined;
  const name = data?.options?.[0]?.name;
  return typeof name === "string" ? name : null;
}
