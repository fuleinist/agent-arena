import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { fillCommand, runArena } from "../src/runner.js";
import { makeGitRepo, makeTmpDir, writeFiles } from "./helpers.js";

const MOCK_FIX = `
import { appendFileSync, writeFileSync } from "node:fs";
writeFileSync("fix.txt", "fixed\\n");
appendFileSync("src/app.txt", "fixed line\\n");
console.log("ARENA_COST: " + JSON.stringify({ usd: 0.42 }));
`;

const MOCK_NOOP = `
console.log("nothing to do");
`;

const MOCK_FAIL = `
console.error("boom");
process.exit(1);
`;

const MOCK_SLOW = `
await new Promise((resolve) => setTimeout(resolve, 30000));
`;

const CHECK_SCRIPT = 'import { existsSync } from "node:fs";\nprocess.exit(existsSync("fix.txt") ? 0 : 1);\n';

function q(path: string): string {
  return `"${path}"`;
}

function setupFixture(root: string): {
  config: ReturnType<typeof loadConfig>;
  scripts: string;
} {
  const scripts = join(root, "scripts");
  writeFiles(scripts, {
    "fix.mjs": MOCK_FIX,
    "noop.mjs": MOCK_NOOP,
    "fail.mjs": MOCK_FAIL,
    "slow.mjs": MOCK_SLOW,
  });
  makeGitRepo(join(root, "app"), {
    "src/app.txt": "hello\n",
    "check.mjs": CHECK_SCRIPT,
  });
  writeFiles(root, {
    ".arena/tasks.json": JSON.stringify(
      {
        tasks: [
          { id: "fix", prompt: "fix the bug", workspace: "./app", verify: `${q(process.execPath)} check.mjs` },
        ],
      },
      null,
      2,
    ),
    ".arena/agents.json": JSON.stringify(
      {
        agents: [
          { name: "fixer", command: `${q(process.execPath)} ${q(join(scripts, "fix.mjs"))} {prompt}` },
          { name: "noop", command: `${q(process.execPath)} ${q(join(scripts, "noop.mjs"))} {prompt}` },
          { name: "failer", command: `${q(process.execPath)} ${q(join(scripts, "fail.mjs"))} {prompt}` },
          {
            name: "slow",
            command: `${q(process.execPath)} ${q(join(scripts, "slow.mjs"))} {prompt}`,
            timeoutSeconds: 2,
          },
        ],
      },
      null,
      2,
    ),
  });
  return { config: loadConfig(root), scripts };
}

test("fillCommand replaces placeholders and quotes the prompt", () => {
  const filled = fillCommand("agent -p {prompt} --file {promptFile} --dir {sandbox}", {
    prompt: 'do "it"\nnow',
    promptFile: "/tmp/prompt.txt",
    sandbox: "/tmp/work",
  });
  assert.equal(filled, 'agent -p "do \\"it\\" now" --file /tmp/prompt.txt --dir /tmp/work');
});

test("fillCommand leaves unknown placeholders alone", () => {
  assert.equal(fillCommand("echo {unknown}", { prompt: "x", promptFile: "y", sandbox: "z" }), "echo {unknown}");
});

test("runArena runs a task matrix and records results", async () => {
  const root = makeTmpDir();
  const { config } = setupFixture(root);
  const { record, runDir } = await runArena(config);
  assert.equal(record.results.length, 4);
  assert.deepEqual(record.tasks, ["fix"]);
  assert.deepEqual(record.agents, ["fixer", "noop", "failer", "slow"]);

  const byAgent = new Map(record.results.map((result) => [result.agent, result]));

  const fixer = byAgent.get("fixer");
  assert.ok(fixer, "fixer result should exist");
  assert.equal(fixer.status, "completed");
  assert.equal(fixer.agentExitCode, 0);
  assert.equal(fixer.verify?.passed, true);
  assert.equal(fixer.cost?.usd, 0.42);
  assert.ok(fixer.changes, "fixer should have changes");
  assert.ok(fixer.changes.files >= 2);
  assert.deepEqual(fixer.changes.added, ["fix.txt"]);
  assert.ok(existsSync(join(runDir, "fix__fixer", "patch.diff")));
  assert.ok(existsSync(join(runDir, "fix__fixer", "work", "fix.txt")));
  assert.ok(existsSync(join(runDir, "fix__fixer", "prompt.txt")));

  const noop = byAgent.get("noop");
  assert.ok(noop, "noop result should exist");
  assert.equal(noop.status, "completed");
  assert.equal(noop.verify?.passed, false);

  const failer = byAgent.get("failer");
  assert.ok(failer, "failer result should exist");
  assert.equal(failer.status, "completed");
  assert.equal(failer.agentExitCode, 1);
  assert.equal(failer.verify?.passed, false);

  const slow = byAgent.get("slow");
  assert.ok(slow, "slow result should exist");
  assert.equal(slow.status, "timeout");
  assert.ok(slow.durationMs < 10000, "slow agent should be killed at the 2s limit");
  assert.equal(slow.verify?.passed, false);

  const runJson = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) as { results: unknown[] };
  assert.equal(runJson.results.length, 4);
  const resultJson = JSON.parse(readFileSync(join(runDir, "fix__fixer", "result.json"), "utf8")) as {
    task: string;
    agent: string;
  };
  assert.equal(resultJson.task, "fix");
  assert.equal(resultJson.agent, "fixer");

  assert.equal(existsSync(join(root, "app", "fix.txt")), false, "source repository stays untouched");
});

test("runArena supports task and agent filters", async () => {
  const root = makeTmpDir();
  const { config } = setupFixture(root);
  const { record } = await runArena(config, { taskIds: ["fix"], agentNames: ["fixer", "noop"] });
  assert.equal(record.results.length, 2);
  assert.deepEqual(record.agents, ["fixer", "noop"]);
});

test("runArena marks a failed setup and skips the agent", async () => {
  const root = makeTmpDir();
  const { config } = setupFixture(root);
  const tasksFile = join(root, ".arena", "tasks.json");
  const tasks = JSON.parse(readFileSync(tasksFile, "utf8")) as { tasks: Record<string, unknown>[] };
  tasks.tasks[0].setup = `"${process.execPath}" -e "process.exit(5)"`;
  writeFiles(root, { ".arena/tasks.json": JSON.stringify(tasks, null, 2) });

  const { record, runDir } = await runArena(loadConfig(root), { agentNames: ["noop"] });
  const result = record.results[0];
  assert.equal(result.status, "setup_failed");
  assert.match(result.error ?? "", /setup exited with code 5/);
  assert.equal(result.verify, null, "verify is skipped after a setup failure");
  assert.equal(existsSync(join(runDir, "fix__noop", "stdout.txt")), false, "agent never ran");
});

test("runArena removes sandboxes when ephemeral is set", async () => {
  const root = makeTmpDir();
  const { config } = setupFixture(root);
  const { record, runDir } = await runArena(config, {
    agentNames: ["noop"],
    ephemeral: true,
  });
  assert.equal(record.results[0].workKept, false);
  assert.equal(existsSync(join(runDir, "fix__noop", "work")), false);
});