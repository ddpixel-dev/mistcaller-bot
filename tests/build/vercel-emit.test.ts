import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Vercel compiles api/*.ts with tsc and ships only the .js output. Relative imports
// written as ".ts" must therefore be rewritten to ".js" or Node cannot resolve them.

const tsconfigPath = new URL("../../tsconfig.json", import.meta.url).pathname;
const root = new URL("../../", import.meta.url).pathname;

function compilerOptions(): ts.CompilerOptions {
  const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  assert.equal(read.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
  return {
    ...parsed.options,
    noEmit: false,
    // transpileModule cannot see package.json "type", so NodeNext would emit CommonJS.
    // ESNext matches what the deployed ESM package looks like; the import rewrite is the same.
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
}

function emit(file: string): string {
  const source = readFileSync(`${root}${file}`, "utf8");
  const out = ts.transpileModule(source, {
    compilerOptions: compilerOptions(),
    fileName: `${root}${file}`,
  });
  return out.outputText;
}

const RELATIVE_TS = /from\s+["']\.{1,2}\/[^"']*\.ts["']/;

test("tsconfig enables rewriteRelativeImportExtensions", () => {
  const raw = JSON.parse(readFileSync(tsconfigPath, "utf8"));
  assert.equal(raw.compilerOptions.rewriteRelativeImportExtensions, true);
});

test("api/discord.ts emits .js relative imports only", () => {
  const js = emit("api/discord.ts");
  assert.doesNotMatch(js, RELATIVE_TS);
  assert.match(js, /from "\.\.\/src\/http\/discord-handler\.js"/);
  assert.match(js, /from "\.\.\/src\/db\/client\.js"/);
});

test("api/cron.ts emits .js relative imports only", () => {
  const js = emit("api/cron.ts");
  assert.doesNotMatch(js, RELATIVE_TS);
  assert.match(js, /from "\.\.\/src\/jobs\/cron-handler\.js"/);
  assert.match(js, /from "\.\.\/src\/db\/client\.js"/);
});
