import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { runCommand } from "../src/shell.js";
import { makeTmpDir } from "./helpers.js";

const node = process.execPath;

function nodeCmd(js: string): string {
  return `"${node}" -e "${js.replace(/"/g, '\\"')}"`;
}

test("runCommand captures stdout and a zero exit code", async () => {
  const result = await runCommand(nodeCmd("console.log('out')"));
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.match(result.stdout, /out/);
});

test("runCommand passes through a nonzero exit code", async () => {
  const result = await runCommand(nodeCmd("process.exit(3)"));
  assert.equal(result.exitCode, 3);
});

test("runCommand captures stderr separately", async () => {
  const result = await runCommand(nodeCmd("console.error('err-line'); console.log('out-line')"));
  assert.match(result.stdout, /out-line/);
  assert.match(result.stderr, /err-line/);
});

test("runCommand runs in the given cwd", async () => {
  const dir = makeTmpDir();
  const result = await runCommand(nodeCmd("console.log(process.cwd())"), { cwd: dir });
  assert.equal(result.exitCode, 0);
  const folder = dir.split(/[\\/]/).pop() ?? dir;
  assert.ok(result.stdout.toLowerCase().includes(folder.toLowerCase()));
});

test("runCommand merges extra environment variables", async () => {
  const result = await runCommand(nodeCmd("console.log(process.env.ARENA_TEST_TOKEN || 'missing')"), {
    env: { ARENA_TEST_TOKEN: "abc123" },
  });
  assert.match(result.stdout, /abc123/);
});

test("runCommand kills the process tree on timeout", async () => {
  const startedAt = Date.now();
  const result = await runCommand(nodeCmd("console.log('started'); setTimeout(() => console.log('late'), 15000)"), {
    timeoutMs: 1000,
  });
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - startedAt < 10000, "killed well before the 15s child would finish");
  assert.match(result.stdout, /started/);
});

test("runCommand reports a spawn error for a missing cwd", async () => {
  const dir = makeTmpDir();
  const result = await runCommand(nodeCmd("console.log('never')"), { cwd: join(dir, "missing-dir") });
  assert.ok(result.spawnError, "expected a spawn error");
});