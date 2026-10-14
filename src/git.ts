import { execFileSync } from "node:child_process";

export function git(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${message}`);
  }
}

export function isGitRepo(dir: string): boolean {
  try {
    return git(["rev-parse", "--is-inside-work-tree"], dir).trim() === "true";
  } catch {
    return false;
  }
}

export function cloneLocal(src: string, dest: string): void {
  git(["clone", "--quiet", "--local", src, dest], process.cwd());
}

export function revParseHead(cwd: string): string {
  return git(["rev-parse", "HEAD"], cwd).trim();
}

export function addAll(cwd: string): void {
  git(["add", "-A"], cwd);
}

export interface NameStatusEntry {
  status: string;
  path: string;
}

export function parseNameStatus(output: string): NameStatusEntry[] {
  const entries: NameStatusEntry[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const status = parts[0][0];
    let path = parts[parts.length - 1];
    if (path.startsWith('"') && path.endsWith('"')) {
      path = path.slice(1, -1).replace(/\\(.)/g, "$1");
    }
    entries.push({ status, path });
  }
  return entries;
}

export interface NumstatSummary {
  insertions: number;
  deletions: number;
  binaryFiles: number;
  files: number;
}

export function parseNumstat(output: string): NumstatSummary {
  let insertions = 0;
  let deletions = 0;
  let binaryFiles = 0;
  let files = 0;
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    files += 1;
    const [ins, del] = parts;
    if (ins === "-" || del === "-") {
      binaryFiles += 1;
      continue;
    }
    insertions += Number.parseInt(ins, 10) || 0;
    deletions += Number.parseInt(del, 10) || 0;
  }
  return { insertions, deletions, binaryFiles, files };
}

export function diffIndexNameStatus(cwd: string, base: string): NameStatusEntry[] {
  return parseNameStatus(git(["diff", "--cached", "--name-status", base], cwd));
}

export function diffIndexNumstat(cwd: string, base: string): NumstatSummary {
  return parseNumstat(git(["diff", "--cached", "--numstat", base], cwd));
}

export function diffIndexPatch(cwd: string, base: string): string {
  return git(["diff", "--cached", "--patch", "--no-color", base], cwd);
}