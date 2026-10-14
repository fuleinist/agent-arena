#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { filterAgents, filterTasks, loadConfig } from "./config.js";
import { loadRun, renderJsonReport, renderTextReport } from "./report.js";
import { runArena } from "./runner.js";

const VERSION = "0.1.0";

const USAGE = `agent-arena ${VERSION} — local arena for coding agents

Usage
  arena init [dir]                 Create .arena/ config in dir (default: .).
  arena run [options]              Run the tasks × agents matrix.
    --task <id>                    Limit to a task id (repeatable).
    --agent <name>                 Limit to an agent name (repeatable).
    --timeout <seconds>            Override the agent timeout.
    --dry-run                      List planned runs without running.
    --ephemeral                    Remove sandboxes after each run.
  arena report [runId] [--json]    Compare results. Default: latest run.
  arena list                       Show configured tasks and agents.
  arena clean <runId>              Remove one run directory.
  arena clean --all                Remove all run directories.

Options
  -h, --help                       Show this help.
  -v, --version                    Show the version.`;

const AGENTS_TEMPLATE = `{
  "agents": [
    {
      "name": "claude",
      "command": "claude -p {prompt} --dangerously-skip-permissions",
      "timeoutSeconds": 900
    },
    {
      "name": "codex",
      "command": "codex exec {prompt}",
      "timeoutSeconds": 900
    }
  ]
}
`;

const TASKS_TEMPLATE = `{
  "tasks": [
    {
      "id": "example-task",
      "prompt": "Describe the change you want. Keep the task small and verifiable.",
      "workspace": "./path-to-your-repo",
      "verify": "npm test"
    }
  ]
}
`;

const ARENA_GITIGNORE = `# Keep runs out of git by default. Remove this rule to commit results.
runs/
`;

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        task: { type: "string", multiple: true },
        agent: { type: "string", multiple: true },
        timeout: { type: "string" },
        "dry-run": { type: "boolean" },
        ephemeral: { type: "boolean" },
        json: { type: "boolean" },
        all: { type: "boolean" },
      },
    });
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    console.error(USAGE);
    return 2;
  }

  const { values, positionals } = parsed;
  const command = positionals[0];

  try {
    if (values.version) {
      console.log(`agent-arena ${VERSION}`);
      return 0;
    }
    if (values.help) {
      console.log(USAGE);
      return 0;
    }
    if (!command) {
      console.error(USAGE);
      return 2;
    }
    switch (command) {
      case "init":
        return cmdInit(positionals[1]);
      case "run":
        return await cmdRun(values, process.cwd());
      case "report":
        return cmdReport(positionals[1], values.json ?? false, process.cwd());
      case "list":
        return cmdList(process.cwd());
      case "clean":
        return cmdClean(positionals[1], values.all ?? false, process.cwd());
      default:
        console.error(`Error: unknown command "${command}".`);
        console.error(USAGE);
        return 2;
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

function cmdInit(dirArg?: string): number {
  const dir = resolve(dirArg ?? ".");
  const arenaDir = join(dir, ".arena");
  mkdirSync(join(arenaDir, "runs"), { recursive: true });
  console.log(writeIfMissing(join(arenaDir, "agents.json"), AGENTS_TEMPLATE));
  console.log(writeIfMissing(join(arenaDir, "tasks.json"), TASKS_TEMPLATE));
  console.log(writeIfMissing(join(arenaDir, ".gitignore"), ARENA_GITIGNORE));
  console.log(`Arena ready at ${arenaDir}`);
  return 0;
}

function writeIfMissing(file: string, content: string): string {
  if (existsSync(file)) return `kept ${file}`;
  writeFileSync(file, content, "utf8");
  return `created ${file}`;
}

async function cmdRun(
  values: {
    task?: string[];
    agent?: string[];
    timeout?: string;
    "dry-run"?: boolean;
    ephemeral?: boolean;
  },
  cwd: string,
): Promise<number> {
  const config = loadConfig(cwd);
  let timeoutOverrideMs: number | undefined;
  if (values.timeout !== undefined) {
    const seconds = Number(values.timeout);
    if (!Number.isFinite(seconds) || seconds < 1) {
      console.error("Error: --timeout must be a number >= 1 (seconds).");
      return 2;
    }
    timeoutOverrideMs = seconds * 1000;
  }
  const tasks = filterTasks(config.tasks, values.task);
  const agents = filterAgents(config.agents, values.agent);
  if (values["dry-run"]) {
    for (const task of tasks) {
      for (const agent of agents) {
        console.log(`would run ${task.id} × ${agent.name}`);
      }
    }
    console.log(`${tasks.length * agents.length} runs planned.`);
    return 0;
  }
  console.log(`Running ${tasks.length} task(s) × ${agents.length} agent(s)...`);
  const { record, runDir } = await runArena(config, {
    taskIds: values.task,
    agentNames: values.agent,
    timeoutOverrideMs,
    ephemeral: values.ephemeral ?? false,
    log: (line) => console.log(line),
  });
  const errors = record.results.filter(
    (result) => result.status === "error" || result.status === "setup_failed",
  ).length;
  console.log(`Run ${record.runId} written to ${runDir}`);
  console.log(`Next: arena report ${record.runId}`);
  return errors > 0 ? 1 : 0;
}

function cmdReport(runId: string | undefined, json: boolean, cwd: string): number {
  const runsRoot = join(resolve(cwd), ".arena", "runs");
  const { record } = loadRun(runsRoot, runId);
  console.log(json ? renderJsonReport(record) : renderTextReport(record));
  return 0;
}

function cmdList(cwd: string): number {
  const config = loadConfig(cwd);
  console.log(`Tasks (${config.tasks.length})`);
  for (const task of config.tasks) {
    console.log(`  ${task.id}  workspace: ${task.workspace}`);
  }
  console.log("");
  console.log(`Agents (${config.agents.length})`);
  for (const agent of config.agents) {
    console.log(`  ${agent.name}  command: ${agent.command}`);
  }
  return 0;
}

function cmdClean(runId: string | undefined, all: boolean, cwd: string): number {
  const runsRoot = resolve(cwd, ".arena", "runs");
  if (!all && !runId) {
    console.error("Error: pass a runId or --all.");
    return 2;
  }
  if (!existsSync(runsRoot)) {
    throw new Error(`No runs directory at ${runsRoot}.`);
  }
  if (all) {
    for (const name of readdirSync(runsRoot)) {
      rmSync(join(runsRoot, name), { recursive: true, force: true });
      console.log(`removed ${name}`);
    }
    return 0;
  }
  const target = resolve(runsRoot, runId as string);
  if (!target.startsWith(runsRoot + sep)) {
    throw new Error(`Invalid run id: ${runId}`);
  }
  if (!existsSync(target)) {
    throw new Error(`Run not found: ${runId}`);
  }
  rmSync(target, { recursive: true, force: true });
  console.log(`removed ${runId}`);
  return 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });