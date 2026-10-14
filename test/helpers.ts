import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { git } from "../src/git.js";

export function makeTmpDir(prefix = "agent-arena-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
}

export function makeGitRepo(dir: string, files: Record<string, string> = { "src/app.txt": "hello\n" }): string {
  mkdirSync(dir, { recursive: true });
  writeFiles(dir, files);
  git(["init", "-q", "-b", "main"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test User"], dir);
  git(["config", "commit.gpgsign", "false"], dir);
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "init"], dir);
  return dir;
}