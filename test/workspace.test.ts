import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { git } from "../src/git.js";
import { collectChanges, createSandbox } from "../src/workspace.js";
import { makeGitRepo, makeTmpDir, writeFiles } from "./helpers.js";

test("createSandbox clones a git workspace and records the baseline commit", () => {
  const root = makeTmpDir();
  const repo = makeGitRepo(join(root, "repo"));
  const dest = join(root, "sandbox", "work");
  const sandbox = createSandbox(repo, dest);
  assert.equal(sandbox.kind, "git");
  assert.equal(sandbox.baselineSha, git(["rev-parse", "HEAD"], repo).trim());
  assert.ok(existsSync(join(dest, "src", "app.txt")));
});

test("createSandbox throws for a missing workspace", () => {
  const root = makeTmpDir();
  assert.throws(() => createSandbox(join(root, "missing"), join(root, "dest")), /Workspace does not exist/);
});

test("createSandbox throws when the destination exists", () => {
  const root = makeTmpDir();
  const repo = makeGitRepo(join(root, "repo"));
  const dest = join(root, "dest");
  mkdirSync(dest);
  assert.throws(() => createSandbox(repo, dest), /already exists/);
});

test("collectChanges with no edits reports zero changes and an empty patch", () => {
  const root = makeTmpDir();
  const repo = makeGitRepo(join(root, "repo"));
  const combo = join(root, "combo");
  mkdirSync(combo, { recursive: true });
  const sandbox = createSandbox(repo, join(combo, "work"));
  const changes = collectChanges(sandbox, combo);
  assert.equal(changes.kind, "git");
  assert.equal(changes.files, 0);
  assert.equal(changes.insertions, 0);
  assert.equal(changes.deletions, 0);
  assert.equal(readFileSync(join(combo, "patch.diff"), "utf8"), "");
});

test("collectChanges detects edits, additions, and deletions", () => {
  const root = makeTmpDir();
  const repo = makeGitRepo(join(root, "repo"), { "src/app.txt": "hello\n", "gone.txt": "gone\n" });
  const combo = join(root, "combo");
  mkdirSync(combo, { recursive: true });
  const sandbox = createSandbox(repo, join(combo, "work"));
  writeFileSync(join(sandbox.dir, "fix.txt"), "fixed\n");
  writeFileSync(join(sandbox.dir, "src", "app.txt"), "hello\nfixed line\n");
  rmSync(join(sandbox.dir, "gone.txt"));
  const changes = collectChanges(sandbox, combo);
  assert.equal(changes.files, 3);
  assert.equal(changes.insertions, 2);
  assert.equal(changes.deletions, 1);
  assert.deepEqual(changes.added, ["fix.txt"]);
  assert.deepEqual(changes.modified, ["src/app.txt"]);
  assert.deepEqual(changes.deleted, ["gone.txt"]);
  assert.equal(changes.patchPath, "patch.diff");
  const patch = readFileSync(join(combo, "patch.diff"), "utf8");
  assert.match(patch, /fix\.txt/);
  assert.match(patch, /gone\.txt/);
});

test("collectChanges finds changes that the agent committed", () => {
  const root = makeTmpDir();
  const repo = makeGitRepo(join(root, "repo"));
  const combo = join(root, "combo");
  mkdirSync(combo, { recursive: true });
  const sandbox = createSandbox(repo, join(combo, "work"));
  writeFileSync(join(sandbox.dir, "fix.txt"), "fixed\n");
  git(["config", "user.email", "test@example.com"], sandbox.dir);
  git(["config", "user.name", "Test User"], sandbox.dir);
  git(["add", "-A"], sandbox.dir);
  git(["commit", "-q", "-m", "agent commit"], sandbox.dir);
  const changes = collectChanges(sandbox, combo);
  assert.equal(changes.files, 1);
  assert.deepEqual(changes.added, ["fix.txt"]);
});

test("createSandbox copies a non-git workspace into a manifest sandbox", () => {
  const root = makeTmpDir();
  const source = join(root, "plain");
  writeFiles(source, { "a.txt": "one", "node_modules/pkg/x.js": "skip" });
  const combo = join(root, "combo");
  mkdirSync(combo, { recursive: true });
  const sandbox = createSandbox(source, join(combo, "work"));
  assert.equal(sandbox.kind, "manifest");
  assert.ok(sandbox.beforeManifest?.has("a.txt"));
  assert.equal(sandbox.beforeManifest?.has("node_modules/pkg/x.js"), false);
  assert.equal(existsSync(join(sandbox.dir, "node_modules")), false);
});

test("collectChanges on a manifest sandbox classifies file changes", () => {
  const root = makeTmpDir();
  const source = join(root, "plain");
  writeFiles(source, { "a.txt": "one", "gone.txt": "g" });
  const combo = join(root, "combo");
  mkdirSync(combo, { recursive: true });
  const sandbox = createSandbox(source, join(combo, "work"));
  writeFileSync(join(sandbox.dir, "a.txt"), "two");
  writeFileSync(join(sandbox.dir, "new.txt"), "n");
  rmSync(join(sandbox.dir, "gone.txt"));
  const changes = collectChanges(sandbox, combo);
  assert.equal(changes.kind, "manifest");
  assert.equal(changes.files, 3);
  assert.equal(changes.insertions, null);
  assert.equal(changes.deletions, null);
  assert.deepEqual(changes.added, ["new.txt"]);
  assert.deepEqual(changes.modified, ["a.txt"]);
  assert.deepEqual(changes.deleted, ["gone.txt"]);
  assert.equal(changes.patchPath, null);
});