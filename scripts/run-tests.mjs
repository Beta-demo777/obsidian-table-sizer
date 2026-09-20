#!/usr/bin/env node
/**
 * Test runner.
 *
 * Bundles the TypeScript tests with esbuild — already a devDependency — and
 * runs them through the Node test runner, so the project needs no extra test
 * framework. The bundle step is what lets the tests import `src/` directly.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

const TEST_DIR = "tests";
const OUT_DIR = "test-out";

const entryPoints = readdirSync(TEST_DIR)
  .filter((name) => name.endsWith(".test.ts"))
  .map((name) => `${TEST_DIR}/${name}`);

if (entryPoints.length === 0) {
  console.error(`No *.test.ts files found in ${TEST_DIR}/`);
  process.exit(1);
}

rmSync(OUT_DIR, { recursive: true, force: true });

await build({
  entryPoints,
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outdir: OUT_DIR,
  outExtension: { ".js": ".cjs" },
  sourcemap: "inline",
  logLevel: "warning",
  // `src/` imports Obsidian's API; the tests supply a stub for it so the real
  // resizer can be exercised outside the app.
  alias: { obsidian: "tests/helpers/obsidian-stub.ts" }
});

const bundles = readdirSync(OUT_DIR)
  .filter((name) => name.endsWith(".cjs"))
  .map((name) => `${OUT_DIR}/${name}`);

// Explicit paths rather than a directory, so discovery never depends on
// Node's test-file naming heuristics.
const result = spawnSync(process.execPath, ["--test", ...bundles], { stdio: "inherit" });
process.exit(result.status ?? 1);
