import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  ConfigError,
  filterAgents,
  filterTasks,
  loadAgents,
  loadConfig,
  loadTasks,
  resolveWorkspace,
} from "../src/config.js";
import { makeTmpDir, writeFiles } from "./helpers.js";

const goodTask = { id: "t1", prompt: "Do the thing.", workspace: "./repo" };
const goodAgent = { name: "a1", command: "echo {prompt}" };

function writeArena(root: string, tasks: unknown, agents: unknown): void {
  writeFiles(root, {
    ".arena/tasks.json": JSON.stringify({ tasks }, null, 2),
    ".arena/agents.json": JSON.stringify({ agents }, null, 2),
  });
}

test("loadConfig loads a valid config", () => {
  const root = makeTmpDir();
  writeArena(root, [goodTask], [goodAgent]);
  const config = loadConfig(root);
  assert.equal(config.tasks.length, 1);
  assert.equal(config.tasks[0].id, "t1");
  assert.equal(config.tasks[0].workspace, "./repo");
  assert.equal(config.agents.length, 1);
  assert.equal(config.agents[0].name, "a1");
  assert.equal(config.arenaDir, join(root, ".arena"));
});

test("loadConfig explains a missing .arena directory", () => {
  const root = makeTmpDir();
  assert.throws(
    () => loadConfig(root),
    (err: unknown) => err instanceof ConfigError && /arena init/.test((err as Error).message),
  );
});

test("loadTasks rejects invalid JSON", () => {
  const root = makeTmpDir();
  writeFiles(root, { ".arena/tasks.json": "{ nope" });
  assert.throws(() => loadTasks(join(root, ".arena", "tasks.json")), /Cannot parse/);
});

test("loadTasks rejects a missing tasks array", () => {
  const root = makeTmpDir();
  writeFiles(root, { ".arena/tasks.json": JSON.stringify({ foo: 1 }) });
  assert.throws(() => loadTasks(join(root, ".arena", "tasks.json")), /"tasks" array/);
});

test("loadTasks rejects a task without a prompt", () => {
  const root = makeTmpDir();
  writeArena(root, [{ id: "t1", workspace: "./repo" }], [goodAgent]);
  assert.throws(() => loadConfig(root), /"prompt"/);
});

test("loadTasks rejects a task without a workspace", () => {
  const root = makeTmpDir();
  writeArena(root, [{ id: "t1", prompt: "x" }], [goodAgent]);
  assert.throws(() => loadConfig(root), /"workspace"/);
});

test("loadTasks rejects duplicate task ids", () => {
  const root = makeTmpDir();
  writeArena(root, [goodTask, goodTask], [goodAgent]);
  assert.throws(() => loadConfig(root), /duplicate task ids: t1/);
});

test("loadTasks rejects a timeout below 1", () => {
  const root = makeTmpDir();
  writeArena(root, [{ ...goodTask, timeoutSeconds: 0 }], [goodAgent]);
  assert.throws(() => loadConfig(root), /timeoutSeconds/);
});

test("loadTasks rejects a non-string setup", () => {
  const root = makeTmpDir();
  writeArena(root, [{ ...goodTask, setup: 5 }], [goodAgent]);
  assert.throws(() => loadConfig(root), /setup/);
});

test("loadTasks treats empty setup and verify as absent", () => {
  const root = makeTmpDir();
  writeArena(root, [{ ...goodTask, setup: "", verify: "" }], [goodAgent]);
  const config = loadConfig(root);
  assert.equal(config.tasks[0].setup, undefined);
  assert.equal(config.tasks[0].verify, undefined);
});

test("loadAgents rejects an agent without a command", () => {
  const root = makeTmpDir();
  writeArena(root, [goodTask], [{ name: "a1" }]);
  assert.throws(() => loadConfig(root), /"command"/);
});

test("loadAgents rejects duplicate agent names", () => {
  const root = makeTmpDir();
  writeArena(root, [goodTask], [goodAgent, goodAgent]);
  assert.throws(() => loadConfig(root), /duplicate agent ids: a1/);
});

test("loadAgents rejects non-string env values", () => {
  const root = makeTmpDir();
  writeArena(root, [goodTask], [{ ...goodAgent, env: { TOKEN: 123 } }]);
  assert.throws(() => loadConfig(root), /env\.TOKEN/);
});

test("loadAgents accepts env with string values", () => {
  const root = makeTmpDir();
  writeArena(root, [goodTask], [{ ...goodAgent, env: { TOKEN: "abc" } }]);
  const agents = loadAgents(join(root, ".arena", "agents.json"));
  assert.deepEqual(agents[0].env, { TOKEN: "abc" });
});

test("filterTasks returns all tasks when no ids are given", () => {
  const tasks = [goodTask, { ...goodTask, id: "t2" }];
  assert.equal(filterTasks(tasks).length, 2);
  assert.equal(filterTasks(tasks, []).length, 2);
});

test("filterTasks selects ids and removes duplicates", () => {
  const tasks = [goodTask, { ...goodTask, id: "t2" }];
  const picked = filterTasks(tasks, ["t2", "t2"]);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].id, "t2");
});

test("filterTasks rejects an unknown id", () => {
  assert.throws(() => filterTasks([goodTask], ["nope"]), /Unknown task id: nope/);
});

test("filterAgents rejects an unknown name", () => {
  assert.throws(() => filterAgents([goodAgent], ["nope"]), /Unknown agent name: nope/);
});

test("resolveWorkspace joins relative paths against the root", () => {
  const root = makeTmpDir();
  assert.equal(resolveWorkspace(root, "./repo"), join(root, "repo"));
});

test("resolveWorkspace keeps absolute paths", () => {
  const root = makeTmpDir();
  const absolute = join(root, "somewhere", "repo");
  assert.equal(resolveWorkspace(root, absolute), absolute);
});