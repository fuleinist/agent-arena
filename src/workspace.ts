import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  addAll,
  cloneLocal,
  diffIndexNameStatus,
  diffIndexNumstat,
  diffIndexPatch,
  isGitRepo,
  revParseHead,
} from "./git.js";
import { buildManifest, DEFAULT_EXCLUDES, diffManifests } from "./manifest.js";
import type { ChangeStats } from "./types.js";
import { PATCH_CAP_BYTES } from "./types.js";

export interface Sandbox {
  dir: string;
  kind: "git" | "manifest";
  baselineSha?: string;
  beforeManifest?: Map<string, string>;
}

export function createSandbox(workspace: string, dest: string): Sandbox {
  if (!existsSync(workspace)) {
    throw new Error(`Workspace does not exist: ${workspace}`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    throw new Error(`Sandbox already exists: ${dest}`);
  }
  if (isGitRepo(workspace)) {
    cloneLocal(workspace, dest);
    return { dir: dest, kind: "git", baselineSha: revParseHead(dest) };
  }
  cpSync(workspace, dest, { recursive: true, filter: makeCopyFilter() });
  return { dir: dest, kind: "manifest", beforeManifest: buildManifest(dest) };
}

export function collectChanges(sandbox: Sandbox, comboDir: string): ChangeStats {
  if (sandbox.kind === "git") {
    const base = sandbox.baselineSha;
    if (!base) throw new Error("Sandbox is missing its baseline commit.");
    addAll(sandbox.dir);
    const entries = diffIndexNameStatus(sandbox.dir, base);
    const numstat = diffIndexNumstat(sandbox.dir, base);
    const patch = diffIndexPatch(sandbox.dir, base);
    writeCappedPatch(join(comboDir, "patch.diff"), patch);
    return {
      kind: "git",
      files: entries.length,
      insertions: numstat.insertions,
      deletions: numstat.deletions,
      added: entries.filter((entry) => entry.status === "A").map((entry) => entry.path),
      modified: entries
        .filter((entry) => entry.status === "M" || entry.status === "T" || entry.status === "R")
        .map((entry) => entry.path),
      deleted: entries.filter((entry) => entry.status === "D").map((entry) => entry.path),
      patchPath: "patch.diff",
    };
  }
  const after = buildManifest(sandbox.dir);
  const diff = diffManifests(sandbox.beforeManifest ?? new Map(), after);
  return {
    kind: "manifest",
    files: diff.added.length + diff.modified.length + diff.deleted.length,
    insertions: null,
    deletions: null,
    added: diff.added,
    modified: diff.modified,
    deleted: diff.deleted,
    patchPath: null,
  };
}

function makeCopyFilter(): (src: string) => boolean {
  const excluded = new Set<string>(DEFAULT_EXCLUDES);
  return (src: string) => {
    const parts = src.split(/[\\/]/);
    return !parts.some((part) => excluded.has(part));
  };
}

function writeCappedPatch(file: string, patch: string): void {
  let content = patch;
  if (content.length > PATCH_CAP_BYTES) {
    content = `${content.slice(0, PATCH_CAP_BYTES)}\n# (patch truncated)\n`;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}