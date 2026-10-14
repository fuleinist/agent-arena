import assert from "node:assert/strict";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildManifest, diffManifests } from "../src/manifest.js";
import { makeTmpDir, writeFiles } from "./helpers.js";

test("buildManifest hashes files with relative slash paths", () => {
  const root = makeTmpDir();
  writeFiles(root, { "a.txt": "hello", "sub/b.txt": "world" });
  const manifest = buildManifest(root);
  assert.equal(manifest.size, 2);
  assert.match(manifest.get("a.txt") ?? "", /^[0-9a-f]{64}$/);
  assert.notEqual(manifest.get("a.txt"), manifest.get("sub/b.txt"));
});

test("buildManifest skips excluded directories", () => {
  const root = makeTmpDir();
  writeFiles(root, {
    "src/a.txt": "x",
    "node_modules/pkg/index.js": "y",
    ".git/config": "z",
    ".arena/runs/x.md": "w",
  });
  const manifest = buildManifest(root);
  assert.deepEqual([...manifest.keys()], ["src/a.txt"]);
});

test("buildManifest is stable for identical trees", () => {
  const a = makeTmpDir();
  const b = makeTmpDir();
  writeFiles(a, { "x.txt": "same", "d/y.txt": "same2" });
  writeFiles(b, { "x.txt": "same", "d/y.txt": "same2" });
  assert.deepEqual([...buildManifest(a).entries()], [...buildManifest(b).entries()]);
});

test("buildManifest changes the hash when content changes", () => {
  const root = makeTmpDir();
  writeFiles(root, { "a.txt": "one" });
  const before = buildManifest(root);
  writeFileSync(join(root, "a.txt"), "two");
  const after = buildManifest(root);
  assert.notEqual(before.get("a.txt"), after.get("a.txt"));
});

test("diffManifests classifies added, modified, and deleted files", () => {
  const root = makeTmpDir();
  writeFiles(root, { "keep.txt": "k", "change.txt": "a", "gone.txt": "g" });
  const before = buildManifest(root);
  writeFiles(root, { "new.txt": "n" });
  writeFileSync(join(root, "change.txt"), "b");
  rmSync(join(root, "gone.txt"));
  const after = buildManifest(root);
  const diff = diffManifests(before, after);
  assert.deepEqual(diff.added, ["new.txt"]);
  assert.deepEqual(diff.modified, ["change.txt"]);
  assert.deepEqual(diff.deleted, ["gone.txt"]);
});

test("diffManifests returns empty lists for identical trees", () => {
  const root = makeTmpDir();
  writeFiles(root, { "a.txt": "same" });
  const manifest = buildManifest(root);
  const diff = diffManifests(manifest, buildManifest(root));
  assert.deepEqual(diff, { added: [], modified: [], deleted: [] });
});

test("buildManifest records symlinks as link entries", (t) => {
  const root = makeTmpDir();
  writeFiles(root, { "target.txt": "t" });
  try {
    symlinkSync(join(root, "target.txt"), join(root, "link.txt"), "file");
  } catch {
    t.skip("symlinks are not available on this machine");
    return;
  }
  const manifest = buildManifest(root);
  assert.match(manifest.get("link.txt") ?? "", /^link:/);
});