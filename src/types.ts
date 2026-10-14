export interface Task {
  id: string;
  prompt: string;
  workspace: string;
  setup?: string;
  verify?: string;
  timeoutSeconds?: number;
}

export interface Agent {
  name: string;
  command: string;
  timeoutSeconds?: number;
  env?: Record<string, string>;
}

export interface ArenaConfig {
  root: string;
  arenaDir: string;
  tasks: Task[];
  agents: Agent[];
}

export type ComboStatus = "completed" | "timeout" | "setup_failed" | "error";

export interface CommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

export interface CostInfo {
  usd?: number;
  tokens?: number | Record<string, number>;
  raw: string;
}

export interface ChangeStats {
  kind: "git" | "manifest";
  files: number;
  insertions: number | null;
  deletions: number | null;
  added: string[];
  modified: string[];
  deleted: string[];
  patchPath: string | null;
}

export interface VerifyResult {
  command: string;
  exitCode: number | null;
  passed: boolean | null;
  timedOut: boolean;
  durationMs: number;
  outputTail: string;
}

export interface ComboResult {
  task: string;
  agent: string;
  status: ComboStatus;
  agentExitCode: number | null;
  agentTimedOut: boolean;
  durationMs: number;
  totalMs: number;
  changes: ChangeStats | null;
  verify: VerifyResult | null;
  cost: CostInfo | null;
  error?: string;
  workDir: string;
  workKept: boolean;
}

export interface RunRecord {
  runId: string;
  startedAt: string;
  endedAt: string;
  tasks: string[];
  agents: string[];
  results: ComboResult[];
}

export const DEFAULT_TIMEOUT_SECONDS = 900;
export const OUTPUT_CAP_BYTES = 256 * 1024;
export const PATCH_CAP_BYTES = 10 * 1024 * 1024;
export const VERIFY_TIMEOUT_SECONDS = 600;
export const VERIFY_OUTPUT_TAIL_CHARS = 4000;