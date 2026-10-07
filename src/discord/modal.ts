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

type Opt = { name?: unknown; type?: number; value?: unknown; focused?: boolean; options?: Opt[] };

// "/content preset save" gives ["preset", "save"]; "/content edit" gives ["edit"].
export function commandPath(i: Interaction): string[] {
  const path: string[] = [];
  let level = (i.data as { options?: Opt[] } | undefined)?.options?.[0];
  while (level && (level.type === 1 || level.type === 2) && typeof level.name === "string") {
    path.push(level.name);
    level = level.options?.[0];
  }
  return path;
}

export function subcommandName(i: Interaction): string | null {
  return commandPath(i)[0] ?? null;
}

// The option list of the deepest subcommand.
function leafOptions(i: Interaction): Opt[] {
  let opts = (i.data as { options?: Opt[] } | undefined)?.options ?? [];
  while (opts[0] && (opts[0].type === 1 || opts[0].type === 2)) opts = opts[0].options ?? [];
  return opts;
}

export function leafOption(i: Interaction, name: string): unknown {
  return leafOptions(i).find((o) => o.name === name)?.value;
}

export function focusedOption(i: Interaction): { name: string; value: string } | null {
  const f = leafOptions(i).find((o) => o.focused === true);
  return f && typeof f.name === "string" ? { name: f.name, value: typeof f.value === "string" ? f.value : "" } : null;
}

export function subOption(i: Interaction, sub: string, name: string): unknown {
  const data = i.data as { options?: { name?: string; options?: { name?: string; value?: unknown }[] }[] } | undefined;
  return data?.options?.find((o) => o.name === sub)?.options?.find((o) => o.name === name)?.value;
}
