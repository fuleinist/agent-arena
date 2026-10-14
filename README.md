# agent-arena

A local arena for coding agents. Define tasks from your own backlog. Run two or more agents on each task. Compare diffs, test results, cost, and time.

Public benchmarks do not reflect your private codebase. agent-arena answers one question: which agent is best on your own tasks?

## Features

- **Tasks** — a prompt, a workspace, and optional setup and verify commands.
- **Agents** — any CLI that runs in a shell: Claude Code, Codex, Gemini CLI, local models.
- **Isolation** — every run gets a fresh sandbox. Your source repository stays clean.
- **Evidence** — each run stores a patch, file stats, verify results, duration, and cost.
- **Comparison** — one report ranks the agents per task.
- **Zero runtime dependencies** — Node.js >= 20 and git are enough.

## Install

Requirements: Node.js >= 20, git, and at least one agent CLI.

    git clone https://github.com/fuleinist/agent-arena.git
    cd agent-arena
    npm install
    npm run build
    npm link          # optional: puts `arena` on your PATH

## Quickstart

1. Open a project that is a git repository.

       cd my-project

2. Create the arena config.

       arena init

3. Edit `.arena/tasks.json`:

       {
         "tasks": [
           {
             "id": "fix-login",
             "prompt": "Fix the login redirect bug. Run the tests when done.",
             "workspace": ".",
             "verify": "npm test"
           }
         ]
       }

4. Edit `.arena/agents.json`:

       {
         "agents": [
           { "name": "claude", "command": "claude -p {prompt} --dangerously-skip-permissions" },
           { "name": "codex", "command": "codex exec {prompt}" }
         ]
       }

5. Run the matrix and read the report.

       arena run
       arena report

## Offline demo

Try agent-arena without an installed agent. The demo uses two mock agents.

1. Make a scratch repository.

       mkdir demo
       cd demo
       git init -b main
       echo "hello" > app.txt
       git add -A
       git commit -m "init"

2. Copy `examples/check-demo.mjs` from the agent-arena checkout into `demo/`. Commit it.

3. Run `arena init`.

4. Replace `.arena/tasks.json`:

       {
         "tasks": [
           {
             "id": "demo",
             "prompt": "Write arena-demo.txt with one line.",
             "workspace": ".",
             "verify": "node check-demo.mjs"
           }
         ]
       }

   Replace `.arena/agents.json`. Use the full path to the agent-arena checkout for `<arena>`:

       {
         "agents": [
           { "name": "mock-fix", "command": "node \"<arena>/examples/mock-fix.mjs\" {prompt}" },
           { "name": "mock-noop", "command": "node \"<arena>/examples/mock-noop.mjs\" {prompt}" }
         ]
       }

5. Run the arena.

       arena run
       arena report

   `mock-fix` passes verify. `mock-noop` fails verify. The report shows both runs side by side.

6. Remove the sandboxes when you are done.

       arena clean --all

## Configuration

### `tasks.json`

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique task id. |
| `prompt` | yes | The instruction text for the agent. |
| `workspace` | yes | Path to the source repository. Relative paths resolve against the project root. |
| `setup` | no | Command that runs in the sandbox before the agent. Example: `npm ci`. |
| `verify` | no | Command that runs after the agent. Exit code 0 means pass. |
| `timeoutSeconds` | no | Agent time limit. Default: 900. |

### `agents.json`

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Unique agent name. |
| `command` | yes | Command line to run in the sandbox. Supports placeholders. |
| `timeoutSeconds` | no | Per-agent default time limit. |
| `env` | no | Extra environment variables. |

### Placeholders

- `{prompt}` — the prompt text with basic shell quoting. Use it for simple one-line prompts.
- `{promptFile}` — path to a file that holds the prompt. Recommended for long or multiline prompts.
- `{sandbox}` — path to the sandbox directory.

### Cost reporting

An agent reports cost by printing one line to stdout:

    ARENA_COST: {"usd": 0.42, "tokens": 12000}

A plain number works too: `ARENA_COST: 0.42`. The last such line wins.

## Commands

    arena init [dir]                 Create .arena/ config in dir (default: .).
    arena run [options]              Run the tasks × agents matrix.
      --task <id>                    Limit to a task id (repeatable).
      --agent <name>                 Limit to an agent name (repeatable).
      --timeout <seconds>            Override the agent timeout.
      --dry-run                      List planned runs without running.
      --ephemeral                    Remove sandboxes after each run.
    arena report [runId] [--json]    Compare results. Default: latest run.
    arena list                       Show configured tasks and agents.
    arena clean <runId> | --all      Remove run directories.

Exit codes: 0 = success, 1 = error, 2 = usage error.

## How it works

1. The arena copies each workspace into a sandbox under `.arena/runs/<runId>/`. Git workspaces use `git clone --local`. Other folders use a plain copy.
2. The setup command runs in the sandbox, when defined.
3. The agent command runs with the sandbox as working directory. A timeout kills the process tree.
4. The arena collects changes. Git sandboxes produce `patch.diff` and line counts.
5. The verify command runs. Exit code 0 means pass.
6. The result lands in `result.json`. The run summary lands in `run.json`.

## Run layout

    .arena/runs/<runId>/
      run.json
      <task>__<agent>/
        result.json
        prompt.txt
        patch.diff
        stdout.txt
        stderr.txt
        work/

`work/` is the sandbox. The arena keeps it for inspection. Remove run directories with `arena clean`.

## Notes and limits

- The sandbox copies committed state only. Uncommitted changes stay out of the run.
- `{prompt}` uses basic quoting. Use `{promptFile}` for long or multiline prompts, especially on Windows.
- Default limits: agents 900s, setup and verify 600s each. Change them with `timeoutSeconds` or `--timeout`.
- agent-arena does not install agents. Install each CLI yourself.
- Cost capture needs the `ARENA_COST` convention. An agent without it shows cost `-`.

## Development

    npm install
    npm test        # build + full test suite (node:test)

## License

MIT