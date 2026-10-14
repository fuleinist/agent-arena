import { createHash } from "node:crypto";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const DEFAULT_EXCLUDES = ["node_modules", ".git", ".arena"] as const;

export function buildManifest(root: string, excludes: readonly string[] = DEFAULT_EXCLUDES): Map<string, string> {
  const out = new Map<string, string>();
  const excludeSet = new Set(excludes);
  walk(root, root, out, excludeSet);
  return out;
}

export interface ManifestDiff {
  added: string[];
  modified: string[];
  deleted: string[];
}

export function diffManifests(before: Map<string, string>, after: Map<string, string>): ManifestDiff {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const [rel, hash] of after) {
    if (!before.has(rel)) {
      added.push(rel);
    } else if (before.get(rel) !== hash) {
      modified.push(rel);
    }
  }
  for (const rel of before.keys()) {
    if (!after.has(rel)) deleted.push(rel);
  }
  added.sort();
  modified.sort();
  deleted.sort();
  return { added, modified, deleted };
}

function walk(dir: string, root: string, out: Map<string, string>, excludes: Set<string>): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      out.set(toRel(root, full), `link:${readlinkSafe(full)}`);
      continue;
    }
    if (entry.isDirectory()) {
      if (excludes.has(entry.name)) continue;
      walk(full, root, out, excludes);
      continue;
    }
    if (entry.isFile()) {
      out.set(toRel(root, full), sha256File(full));
    }
  }
}

function toRel(root: string, full: string): string {
  return relative(root, full).split(sep).join("/");
}

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readlinkSafe(path: string): string {
  try {
    return readlinkSync(path);
  } catch {
    return "?";
  }
}