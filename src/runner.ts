import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { filterAgents, filterTasks, resolveWorkspace } from "./config.js";
import { parseCost } from "./cost.js";
import { formatDuration } from "./format.js";
import { runCommand } from "./shell.js";
import { collectChanges, createSandbox, type Sandbox } from "./workspace.js";
import type {
  Agent,
  ArenaConfig,
  CommandResult,
  ComboResult,
  RunRecord,
  Task,
  VerifyResult,
} from "./types.js";
import { DEFAULT_TIMEOUT_SECONDS, VERIFY_OUTPUT_TAIL_CHARS, VERIFY_TIMEOUT_SECONDS } from "./types.js";

export interface RunArenaOptions {
  taskIds?: string[];
  agentNames?: string[];
  timeoutOverrideMs?: number;
  ephemeral?: boolean;
  log?: (line: string) => void;
}

export interface RunOutcome {
  record: RunRecord;
  runDir: string;
}

export interface CommandPlaceholders {
  prompt: string;
  promptFile: string;
  sandbox: string;
}

export async function runArena(config: ArenaConfig, opts: RunArenaOptions = {}): Promise<RunOutcome> {
  const tasks = filterTasks(config.tasks, opts.taskIds);
  const agents = filterAgents(config.agents, opts.agentNames);
  if (tasks.length === 0) throw new Error("No tasks to run.");
  if (agents.length === 0) throw new Error("No agents to run.");

  const startedAt = new Date();
  const runId = makeRunId(startedAt);
  const runsRoot = join(config.arenaDir, "runs");
  let runDir = join(runsRoot, runId);
  let suffix = 2;
  while (existsSync(runDir)) {
    runDir = join(runsRoot, `${runId}-${suffix}`);
    suffix += 1;
  }
  mkdirSync(runDir, { recursive: true });

  const results: ComboResult[] = [];
  for (const task of tasks) {
    for (const agent of agents) {
      const comboDir = join(runDir, `${sanitizeName(task.id)}__${sanitizeName(agent.name)}`);
      mkdirSync(comboDir, { recursive: true });
      opts.log?.(`▶ ${task.id} × ${agent.name}`);
      const result = await runCombo(config, task, agent, comboDir, opts);
      results.push(result);
      writeFileSync(join(comboDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
      opts.log?.(`  ${summarize(result)}`);
    }
  }

  const record: RunRecord = {
    runId,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    tasks: tasks.map((task) => task.id),
    agents: agents.map((agent) => agent.name),
    results,
  };
  writeFileSync(join(runDir, "run.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { record, runDir };
}

export function fillCommand(template: string, values: CommandPlaceholders): string {
  return template
    .split("{prompt}")
    .join(quoteForShell(values.prompt))
    .split("{promptFile}")
    .join(values.promptFile)
    .split("{sandbox}")
    .join(values.sandbox);
}

export function quoteForShell(text: string): string {
  const collapsed = text.replace(/\r?\n/g, " ");
  return `"${collapsed.replace(/"/g, '\\"')}"`;
}

async function runCombo(
  config: ArenaConfig,
  task: Task,
  agent: Agent,
  comboDir: string,
  opts: RunArenaOptions,
): Promise<ComboResult> {
  const startedAt = Date.now();
  const workDir = join(comboDir, "work");
  const promptFile = join(comboDir, "prompt.txt");
  writeFileSync(promptFile, `${task.prompt}\n`, "utf8");

  const result: ComboResult = {
    task: task.id,
    agent: agent.name,
    status: "error",
    agentExitCode: null,
    agentTimedOut: false,
    durationMs: 0,
    totalMs: 0,
    changes: null,
    verify: null,
    cost: null,
    workDir: "work",
    workKept: true,
  };

  let sandbox: Sandbox | null = null;
  try {
    const workspace = resolveWorkspace(config.root, task.workspace);
    sandbox = createSandbox(workspace, workDir);

    if (task.setup) {
      const setupResult = await runCommand(task.setup, {
        cwd: workDir,
        timeoutMs: VERIFY_TIMEOUT_SECONDS * 1000,
      });
      if (setupResult.spawnError || setupResult.timedOut || setupResult.exitCode !== 0) {
        result.status = "setup_failed";
        result.error = describeFailure("setup", setupResult);
      }
    }

    if (result.status !== "setup_failed") {
      const timeoutMs =
        opts.timeoutOverrideMs ??
        secondsToMs(task.timeoutSeconds ?? agent.timeoutSeconds) ??
        DEFAULT_TIMEOUT_SECONDS * 1000;
      const command = fillCommand(agent.command, { prompt: task.prompt, promptFile, sandbox: workDir });
      const agentResult = await runCommand(command, { cwd: workDir, timeoutMs, env: agent.env });
      result.agentExitCode = agentResult.exitCode;
      result.agentTimedOut = agentResult.timedOut;
      result.durationMs = agentResult.durationMs;
      result.cost = parseCost(agentResult.stdout);
      writeFileSync(join(comboDir, "stdout.txt"), agentResult.stdout, "utf8");
      writeFileSync(join(comboDir, "stderr.txt"), agentResult.stderr, "utf8");
      if (agentResult.spawnError) {
        result.status = "error";
        result.error = agentResult.spawnError;
      } else if (agentResult.timedOut) {
        result.status = "timeout";
      } else {
        result.status = "completed";
      }
    }

    result.changes = collectChanges(sandbox, comboDir);

    if (task.verify && (result.status === "completed" || result.status === "timeout")) {
      result.verify = await runVerify(task.verify, workDir);
    }
  } catch (err) {
    result.status = "error";
    result.error = err instanceof Error ? err.message : String(err);
  }

  result.totalMs = Date.now() - startedAt;
  if (opts.ephemeral) {
    try {
      rmSync(workDir, { recursive: true, force: true });
      result.workKept = false;
    } catch {
      // keep the sandbox when removal fails
    }
  }
  return result;
}

async function runVerify(command: string, cwd: string): Promise<VerifyResult> {
  const verifyResult = await runCommand(command, { cwd, timeoutMs: VERIFY_TIMEOUT_SECONDS * 1000 });
  const combined = `${verifyResult.stdout}${verifyResult.stderr ? `\n${verifyResult.stderr}` : ""}`;
  return {
    command,
    exitCode: verifyResult.exitCode,
    passed: !verifyResult.spawnError && !verifyResult.timedOut && verifyResult.exitCode === 0,
    timedOut: verifyResult.timedOut,
    durationMs: verifyResult.durationMs,
    outputTail: tail(combined, VERIFY_OUTPUT_TAIL_CHARS),
  };
}

function makeRunId(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function secondsToMs(seconds: number | undefined): number | undefined {
  return seconds === undefined ? undefined : seconds * 1000;
}

function describeFailure(label: string, result: CommandResult): string {
  if (result.spawnError) return `${label} failed to start: ${result.spawnError}`;
  if (result.timedOut) return `${label} timed out after ${Math.round(result.durationMs / 1000)}s`;
  return `${label} exited with code ${result.exitCode}`;
}

function summarize(result: ComboResult): string {
  const parts: string[] = [result.status];
  if (result.verify) parts.push(result.verify.passed ? "verify pass" : "verify fail");
  if (result.changes && result.changes.files > 0) {
    if (result.changes.insertions === null) {
      parts.push(`${result.changes.files} files`);
    } else {
      parts.push(`${result.changes.files} files +${result.changes.insertions}/-${result.changes.deletions}`);
    }
  }
  parts.push(formatDuration(result.durationMs));
  return parts.join(" | ");
}

function tail(text: string, max: number): string {
  return text.length <= max ? text : text.slice(text.length - max);
}