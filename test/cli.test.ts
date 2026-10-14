import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { makeGitRepo, makeTmpDir, writeFiles } from "./helpers.js";

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(cwd: string, args: string[]): CliRun {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const MOCK_FIX = `
import { appendFileSync, writeFileSync } from "node:fs";
writeFileSync("fix.txt", "fixed\\n");
appendFileSync("src/app.txt", "fixed line\\n");
console.log("ARENA_COST: " + JSON.stringify({ usd: 0.42 }));
`;

const MOCK_NOOP = `
console.log("nothing to do");
`;

function q(path: string): string {
  return `"${path}"`;
}

function setupProject(root: string): void {
  const scripts = join(root, "scripts");
  writeFiles(scripts, { "fix.mjs": MOCK_FIX, "noop.mjs": MOCK_NOOP });
  makeGitRepo(join(root, "app"), {
    "src/app.txt": "hello\n",
    "check.mjs": 'import { existsSync } from "node:fs";\nprocess.exit(existsSync("fix.txt") ? 0 : 1);\n',
  });
  const init = runCli(root, ["init"]);
  assert.equal(init.status, 0);
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
        ],
      },
      null,
      2,
    ),
  });
}

test("cli --help prints usage and exits 0", () => {
  const root = makeTmpDir();
  const { status, stdout } = runCli(root, ["--help"]);
  assert.equal(status, 0);
  assert.match(stdout, /Usage/);
});

test("cli without a command exits 2", () => {
  const root = makeTmpDir();
  const { status } = runCli(root, []);
  assert.equal(status, 2);
});

test("cli rejects an unknown command", () => {
  const root = makeTmpDir();
  const { status, stderr } = runCli(root, ["bogus"]);
  assert.equal(status, 2);
  assert.match(stderr, /unknown command/);
});

test("cli rejects an unknown option", () => {
  const root = makeTmpDir();
  const { status } = runCli(root, ["run", "--bogus"]);
  assert.equal(status, 2);
});

test("cli init creates the .arena scaffold and does not overwrite", () => {
  const root = makeTmpDir();
  const first = runCli(root, ["init"]);
  assert.equal(first.status, 0);
  assert.ok(existsSync(join(root, ".arena", "agents.json")));
  assert.ok(existsSync(join(root, ".arena", "tasks.json")));
  assert.ok(existsSync(join(root, ".arena", "runs")));
  writeFiles(root, { ".arena/agents.json": '{"agents":[]}' });
  const second = runCli(root, ["init"]);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /kept/);
  assert.equal(readFileSync(join(root, ".arena", "agents.json"), "utf8"), '{"agents":[]}');
});

test("cli runs end to end: init, run, report, list, clean", () => {
  const root = makeTmpDir();
  setupProject(root);

  const run = runCli(root, ["run"]);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /fixer/);
  const runsRoot = join(root, ".arena", "runs");
  const runIds = readdirSync(runsRoot);
  assert.equal(runIds.length, 1);

  const report = runCli(root, ["report"]);
  assert.equal(report.status, 0);
  assert.match(report.stdout, /fix/);
  assert.match(report.stdout, /fixer/);
  assert.match(report.stdout, /pass/);

  const reportJson = runCli(root, ["report", "--json"]);
  assert.equal(reportJson.status, 0);
  const parsed = JSON.parse(reportJson.stdout) as { results: unknown[] };
  assert.equal(parsed.results.length, 2);

  const list = runCli(root, ["list"]);
  assert.equal(list.status, 0);
  assert.match(list.stdout, /fix/);
  assert.match(list.stdout, /fixer/);

  const clean = runCli(root, ["clean", "--all"]);
  assert.equal(clean.status, 0);
  assert.equal(readdirSync(runsRoot).length, 0);

  const reportAfter = runCli(root, ["report"]);
  assert.equal(reportAfter.status, 1);
});

test("cli run fails without .arena", () => {
  const root = makeTmpDir();
  const { status, stderr } = runCli(root, ["run"]);
  assert.equal(status, 1);
  assert.match(stderr, /arena init/);
});

test("cli run rejects an unknown task id", () => {
  const root = makeTmpDir();
  setupProject(root);
  const { status, stderr } = runCli(root, ["run", "--task", "nope"]);
  assert.equal(status, 1);
  assert.match(stderr, /Unknown task id/);
});

test("cli run --dry-run lists planned runs", () => {
  const root = makeTmpDir();
  setupProject(root);
  const { status, stdout } = runCli(root, ["run", "--dry-run"]);
  assert.equal(status, 0);
  assert.match(stdout, /would run fix × fixer/);
  assert.equal(readdirSync(join(root, ".arena", "runs")).length, 0);
});

test("cli clean without a target exits 2", () => {
  const root = makeTmpDir();
  const { status } = runCli(root, ["clean"]);
  assert.equal(status, 2);
});