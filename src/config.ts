import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Agent, ArenaConfig, Task } from "./types.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(root: string): ArenaConfig {
  const projectRoot = resolve(root);
  const arenaDir = join(projectRoot, ".arena");
  return {
    root: projectRoot,
    arenaDir,
    tasks: loadTasks(join(arenaDir, "tasks.json")),
    agents: loadAgents(join(arenaDir, "agents.json")),
  };
}

export function loadTasks(file: string): Task[] {
  const data = readJson(file, "tasks.json");
  const record = requireObject(data, file);
  const list = record.tasks;
  if (!Array.isArray(list)) {
    throw new ConfigError(`${file}: expected an object with a "tasks" array.`);
  }
  const tasks = list.map((item, index) => parseTask(item, file, index));
  assertUnique(tasks.map((task) => task.id), "task", file);
  return tasks;
}

export function loadAgents(file: string): Agent[] {
  const data = readJson(file, "agents.json");
  const record = requireObject(data, file);
  const list = record.agents;
  if (!Array.isArray(list)) {
    throw new ConfigError(`${file}: expected an object with an "agents" array.`);
  }
  const agents = list.map((item, index) => parseAgent(item, file, index));
  assertUnique(agents.map((agent) => agent.name), "agent", file);
  return agents;
}

export function filterTasks(tasks: Task[], ids?: string[]): Task[] {
  return filterBy(tasks, ids, (task) => task.id, "task id");
}

export function filterAgents(agents: Agent[], names?: string[]): Agent[] {
  return filterBy(agents, names, (agent) => agent.name, "agent name");
}

export function resolveWorkspace(root: string, workspace: string): string {
  return isAbsolute(workspace) ? workspace : resolve(root, workspace);
}

function parseTask(item: unknown, file: string, index: number): Task {
  const where = `${file}: tasks[${index}]`;
  const record = requireObject(item, where);
  const task: Task = {
    id: requireString(record, "id", where),
    prompt: requireString(record, "prompt", where),
    workspace: requireString(record, "workspace", where),
  };
  const setup = optionalString(record, "setup", where);
  if (setup !== undefined) task.setup = setup;
  const verify = optionalString(record, "verify", where);
  if (verify !== undefined) task.verify = verify;
  const timeoutSeconds = optionalTimeout(record, "timeoutSeconds", where);
  if (timeoutSeconds !== undefined) task.timeoutSeconds = timeoutSeconds;
  return task;
}

function parseAgent(item: unknown, file: string, index: number): Agent {
  const where = `${file}: agents[${index}]`;
  const record = requireObject(item, where);
  const agent: Agent = {
    name: requireString(record, "name", where),
    command: requireString(record, "command", where),
  };
  const timeoutSeconds = optionalTimeout(record, "timeoutSeconds", where);
  if (timeoutSeconds !== undefined) agent.timeoutSeconds = timeoutSeconds;
  const env = record.env;
  if (env !== undefined) {
    const envRecord = requireObject(env, `${where}.env`);
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(envRecord)) {
      if (typeof value !== "string") {
        throw new ConfigError(`${where}: "env.${key}" must be a string.`);
      }
      out[key] = value;
    }
    agent.env = out;
  }
  return agent;
}

function filterBy<T>(items: T[], wanted: string[] | undefined, pick: (item: T) => string, label: string): T[] {
  if (!wanted || wanted.length === 0) return items;
  const unique = [...new Set(wanted)];
  return unique.map((id) => {
    const found = items.find((item) => pick(item) === id);
    if (!found) throw new ConfigError(`Unknown ${label}: ${id}.`);
    return found;
  });
}

function assertUnique(ids: string[], kind: string, file: string): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size > 0) {
    throw new ConfigError(`${file}: duplicate ${kind} ids: ${[...duplicates].join(", ")}`);
  }
}

function readJson(file: string, label: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new ConfigError(`Cannot read ${label} at ${file}. Run "arena init" first.`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`Cannot parse ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function requireObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(`${where}: expected an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`${where}: "${key}" must be a non-empty string.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string, where: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ConfigError(`${where}: "${key}" must be a string.`);
  }
  return value;
}

function optionalTimeout(record: Record<string, unknown>, key: string, where: string): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new ConfigError(`${where}: "${key}" must be a number >= 1 (seconds).`);
  }
  return value;
}