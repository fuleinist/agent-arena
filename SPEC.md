# agent-arena — SPEC

A local arena for coding agents. Define tasks from your own backlog. Run Claude Code, Codex, Gemini CLI, and local models against them. Compare diffs, test results, cost, and time.

This document is the implementation spec for v0.1.0. The build follows it cycle by cycle.

## Goals

- Run one or more coding agents on real repository tasks.
- Isolate every run in its own sandbox. The source repository stays clean.
- Capture a reviewable result set for each run: changes, patch, verify outcome, cost, and duration.
- Compare agents per task with one report command.
- Zero runtime dependencies. Node.js >= 20. TypeScript sources.

## Non-goals (v0.1)

- Remote execution or cloud runners.
- A web UI.
- Automatic agent installation. The user installs each agent CLI.
- Billing integration. Cost comes from the `ARENA_COST` convention (see below).

## Concepts

### Task

A task is one unit of work. Fields:

- `id` (required) — unique task id.
- `prompt` (required) — the instruction text for the agent.
- `workspace` (required) — path to the source repository. Relative paths resolve against the project root.
- `setup` (optional) — command that runs in the sandbox before the agent. Example: `npm ci`.
- `verify` (optional) — command that runs after the agent. Exit code 0 means pass.
- `timeoutSeconds` (optional) — agent time limit. Default: 900.

### Agent

An agent is one coding-agent CLI. Fields:

- `name` (required) — unique agent name.
- `command` (required) — command line to run in the sandbox. Supports placeholders.
- `timeoutSeconds` (optional) — per-agent default time limit.
- `env` (optional) — extra environment variables.

Placeholders in `command`:

- `{prompt}` — the prompt text with basic shell quoting. Use it for simple one-line prompts.
- `{promptFile}` — path to a file that holds the prompt. Recommended for long or multiline prompts.
- `{sandbox}` — path to the sandbox directory.

### Cost convention

An agent reports cost by printing one line to stdout:

    ARENA_COST: {"usd": 0.42, "tokens": 12000}

A plain number is accepted too: `ARENA_COST: 0.42`. The last such line wins.

## Layout

    .arena/
      tasks.json
      agents.json
      runs/<runId>/
        run.json
        <task>__<agent>/
          result.json
          prompt.txt
          patch.diff
          stdout.txt
          stderr.txt
          work/

`work/` is the sandbox. The arena keeps it for inspection. Use `arena clean` to remove runs. Use `--ephemeral` to drop sandboxes right away.

## Commands

- `arena init [dir]` — create `.arena/` with `agents.json`, `tasks.json`, and `runs/`. Never overwrite existing files.
- `arena run [--task <id>]... [--agent <name>]... [--timeout <seconds>] [--dry-run] [--ephemeral]` — run the tasks × agents matrix.
- `arena report [runId] [--json]` — show a comparison table. Default: latest run.
- `arena list` — show configured tasks and agents.
- `arena clean <runId> | --all` — remove run directories.

Exit codes: 0 success, 1 config or run error, 2 usage error.

## Run semantics

For each task × agent pair:

1. Create a sandbox in `runs/<runId>/<task>__<agent>/work`. Use `git clone --local` for git workspaces. Use a recursive copy otherwise.
2. Run `setup` if defined. A failure marks the run `setup_failed` and skips the agent.
3. Run the agent command in the sandbox. Enforce the time limit. Kill the process tree on timeout.
4. Collect changes. For git sandboxes, stage all changes and diff the index against the baseline commit. Save `patch.diff` and count files and lines. For plain copies, diff file manifests.
5. Run `verify` after completed and timed-out agent runs. Record the exit code and an output tail.
6. Parse cost from stdout.
7. Write `result.json`.

## Status values

- `completed` — the agent process ended normally.
- `timeout` — the arena killed the agent at the time limit.
- `setup_failed` — the setup command failed.
- `error` — the arena could not run or collect the agent.

## Verify result

`passed` is true when the verify command exits 0, false otherwise, null when there is no verify command.

## Report

A text table grouped by task. Columns: agent, status, verify, time, files, lines, cost.

The summary names a winner per task. The winner is the run with a passing verify and the lowest duration. If no run passed, the report states that.

## Acceptance criteria

1. `npm run build` is clean.
2. `npm test` passes. Tests use Node's built-in test runner.
3. An end-to-end test covers `init` → `run` → `report` with a mock agent.
4. Tests cover these cases: a passing fix, a failing verify, a nonzero agent exit, a timeout, a setup failure.
5. Runs are isolated. The source repository stays unchanged.