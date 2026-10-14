import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { loadRun, renderJsonReport, renderTextReport } from "../src/report.js";
import type { ChangeStats, ComboResult, RunRecord } from "../src/types.js";
import { makeTmpDir, writeFiles } from "./helpers.js";

function makeResult(overrides: Partial<ComboResult> & { agent: string }): ComboResult {
  return {
    task: "fix",
    status: "completed",
    agentExitCode: 0,
    agentTimedOut: false,
    durationMs: 60000,
    totalMs: 65000,
    changes: null,
    verify: null,
    cost: null,
    workDir: "work",
    workKept: true,
    ...overrides,
  };
}

function makeRecord(): RunRecord {
  const changes: ChangeStats = {
    kind: "git",
    files: 2,
    insertions: 2,
    deletions: 0,
    added: ["fix.txt"],
    modified: ["src/app.txt"],
    deleted: [],
    patchPath: "patch.diff",
  };
  return {
    runId: "20261015-060000",
    startedAt: "2026-10-15T06:00:00.000Z",
    endedAt: "2026-10-15T06:05:00.000Z",
    tasks: ["fix"],
    agents: ["fast", "slow"],
    results: [
      makeResult({
        agent: "fast",
        durationMs: 60000,
        changes,
        verify: { command: "t", exitCode: 0, passed: true, timedOut: false, durationMs: 100, outputTail: "" },
        cost: { usd: 0.42, raw: 'ARENA_COST: {"usd":0.42}' },
      }),
      makeResult({
        agent: "slow",
        durationMs: 120000,
        verify: { command: "t", exitCode: 1, passed: false, timedOut: false, durationMs: 100, outputTail: "" },
      }),
    ],
  };
}

test("renderTextReport shows run, rows, and a winner", () => {
  const text = renderTextReport(makeRecord());
  assert.match(text, /Run 20261015-060000/);
  assert.match(text, /1 task × 2 agents/);
  assert.match(text, /fast/);
  assert.match(text, /pass/);
  assert.match(text, /fail/);
  assert.match(text, /\$0\.42/);
  assert.match(text, /fix: winner fast/);
  assert.match(text, /totals: 2 combos, 1 passed, 1 failed/);
});

test("renderTextReport reports when nothing passed", () => {
  const record = makeRecord();
  record.agents = ["slow"];
  record.results = [
    makeResult({
      agent: "slow",
      verify: { command: "t", exitCode: 1, passed: false, timedOut: false, durationMs: 100, outputTail: "" },
    }),
  ];
  const text = renderTextReport(record);
  assert.match(text, /fix: no verify pass/);
});

test("renderJsonReport round-trips the record", () => {
  const record = makeRecord();
  const parsed = JSON.parse(renderJsonReport(record)) as RunRecord;
  assert.equal(parsed.runId, record.runId);
  assert.equal(parsed.results.length, 2);
});

test("loadRun returns the latest run by default and by explicit id", () => {
  const root = makeTmpDir();
  const runsRoot = join(root, "runs");
  const base = { startedAt: "x", endedAt: "y", tasks: ["t"], agents: ["a"], results: [] };
  writeFiles(runsRoot, {
    "20261014-100000/run.json": JSON.stringify({ ...base, runId: "20261014-100000" }),
    "20261015-090000/run.json": JSON.stringify({ ...base, runId: "20261015-090000" }),
  });
  const latest = loadRun(runsRoot);
  assert.equal(latest.record.runId, "20261015-090000");
  const explicit = loadRun(runsRoot, "20261014-100000");
  assert.equal(explicit.record.runId, "20261014-100000");
});

test("loadRun explains missing runs", () => {
  const root = makeTmpDir();
  assert.throws(() => loadRun(join(root, "runs")), /arena run/);
  const runsRoot = join(root, "runs2");
  writeFiles(runsRoot, { "keep.txt": "" });
  assert.throws(() => loadRun(runsRoot), /No runs found/);
});

test("loadRun rejects an unknown run id", () => {
  const root = makeTmpDir();
  const runsRoot = join(root, "runs");
  writeFiles(runsRoot, {
    "20261015-090000/run.json": JSON.stringify({
      runId: "20261015-090000",
      startedAt: "x",
      endedAt: "y",
      tasks: [],
      agents: [],
      results: [],
    }),
  });
  assert.throws(() => loadRun(runsRoot, "20261015-000000"), /Run not found/);
});