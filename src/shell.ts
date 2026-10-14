import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { CommandResult } from "./types.js";
import { OUTPUT_CAP_BYTES } from "./types.js";

export interface RunCommandOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  maxOutputBytes?: number;
}

const KILL_GRACE_MS = 3000;

export function runCommand(command: string, opts: RunCommandOptions = {}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const maxOutput = opts.maxOutputBytes ?? OUTPUT_CAP_BYTES;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };

    let child: ChildProcess;
    try {
      child = spawn(command, [], {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env ?? {}) },
        shell: true,
        windowsHide: true,
        detached: process.platform !== "win32",
      });
    } catch (err) {
      finish({
        exitCode: null,
        signal: null,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        spawnError: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let timeoutTimer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        killTree(child);
        killTimer = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish({
            exitCode: null,
            signal: null,
            timedOut: true,
            durationMs: Date.now() - startedAt,
            stdout,
            stderr,
          });
        }, KILL_GRACE_MS);
      }, opts.timeoutMs);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk, maxOutput);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk, maxOutput);
    });

    child.on("error", (err) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      finish({
        exitCode: null,
        signal: null,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        spawnError: err.message,
      });
    });

    child.on("close", (code, signal) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      finish({
        exitCode: code,
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
  });
}

function appendCapped(current: string, chunk: Buffer, cap: number): string {
  const next = current + chunk.toString("utf8");
  return next.length <= cap ? next : next.slice(next.length - cap);
}

function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // fall through to child.kill below
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // the process may already be gone
  }
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // the process group may already be gone
    }
  }
}