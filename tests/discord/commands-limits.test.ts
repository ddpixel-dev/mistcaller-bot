import { test } from "node:test";
import assert from "node:assert/strict";
import { commands, type CommandOption } from "../../src/discord/commands.ts";

// Discord rejects the whole command list when a name or a description is too long (100 characters), when a name is not
// lowercase, or when an option list is not in the allowed order. Registering is the only place this shows, so check it here.
function check(path: string, o: { name: string; description: string; options?: CommandOption[] }, problems: string[]) {
  if (Array.from(o.description).length > 100) problems.push(`${path}: description is ${Array.from(o.description).length} characters`);
  if (o.name.length > 32 || o.name !== o.name.toLowerCase() || !/^[\w-]+$/u.test(o.name)) problems.push(`${path}: bad name`);
  const seenOptional = (o.options ?? []).findIndex((x) => x.required !== true);
  if (seenOptional !== -1 && (o.options ?? []).slice(seenOptional).some((x) => x.required === true)) problems.push(`${path}: a required option comes after an optional one`);
  if ((o.options ?? []).length > 25) problems.push(`${path}: more than 25 options`);
  for (const sub of o.options ?? []) check(`${path} ${sub.name}`, sub, problems);
}

test("every command, subcommand and option fits Discord's limits", () => {
  const problems: string[] = [];
  for (const c of commands) check(c.name, c as never, problems);
  assert.deepEqual(problems, []);
});
