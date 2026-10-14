import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { formatCost, formatDuration } from "./format.js";
import type { ChangeStats, ComboResult, RunRecord } from "./types.js";

export function loadRun(runsRoot: string, runId?: string): { record: RunRecord; runDir: string } {
  if (!existsSync(runsRoot)) {
    throw new Error(`No runs directory at ${runsRoot}. Run "arena run" first.`);
  }
  const names = readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(runsRoot, name, "run.json")))
    .sort();
  if (names.length === 0) {
    throw new Error(`No runs found in ${runsRoot}. Run "arena run" first.`);
  }
  let selected: string;
  if (runId) {
    if (!names.includes(runId)) throw new Error(`Run not found: ${runId}`);
    selected = runId;
  } else {
    selected = names[names.length - 1];
  }
  const runDir = join(runsRoot, selected);
  const record = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) as RunRecord;
  return { record, runDir };
}

export function renderTextReport(record: RunRecord): string {
  const lines: string[] = [];
  const taskCount = record.tasks.length;
  const agentCount = record.agents.length;
  lines.push(`Run ${record.runId} — ${taskCount} task${plural(taskCount)} × ${agentCount} agent${plural(agentCount)}`);
  lines.push("");
  for (const task of record.tasks) {
    const rows = record.results.filter((result) => result.task === task);
    lines.push(task);
    lines.push(renderRows(rows));
    lines.push("");
  }
  lines.push(...renderSummary(record));
  return lines.join("\n");
}

export function renderJsonReport(record: RunRecord): string {
  return JSON.stringify(record, null, 2);
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

function renderRows(rows: ComboResult[]): string {
  if (rows.length === 0) return "  (no results)";
  const table = rows.map((result) => ({
    agent: result.agent,
    status: result.status,
    verify: result.verify ? (result.verify.passed ? "pass" : "fail") : "-",
    time: formatDuration(result.durationMs),
    files: String(result.changes?.files ?? 0),
    lines: formatLines(result.changes ?? null),
    cost: formatCost(result.cost),
  }));
  return renderTable(table);
}

function formatLines(changes: ChangeStats | null): string {
  if (!changes) return "-";
  if (changes.insertions === null || changes.deletions === null) return "-";
  return `+${changes.insertions}/-${changes.deletions}`;
}

function renderTable(rows: Array<Record<string, string>>): string {
  const columns = Object.keys(rows[0]);
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const format = (row: Record<string, string>): string =>
    ("  " + columns.map((column, index) => (row[column] ?? "").padEnd(widths[index])).join("  ")).trimEnd();
  const header = Object.fromEntries(columns.map((column) => [column, column.toUpperCase()]));
  return [format(header), ...rows.map(format)].join("\n");
}

function renderSummary(record: RunRecord): string[] {
  const lines: string[] = ["Summary"];
  for (const task of record.tasks) {
    const rows = record.results.filter((result) => result.task === task);
    const passed = rows.filter((result) => result.verify?.passed === true);
    if (passed.length > 0) {
      const winner = passed.reduce((best, current) => (current.durationMs < best.durationMs ? current : best));
      lines.push(`  ${task}: winner ${winner.agent} (verify pass, ${formatDuration(winner.durationMs)})`);
      continue;
    }
    const completed = rows.filter((result) => result.status === "completed");
    if (completed.length > 0) {
      const best = completed.reduce((first, current) => (current.durationMs < first.durationMs ? current : first));
      lines.push(`  ${task}: no verify pass (best ${best.agent}, ${formatDuration(best.durationMs)})`);
      continue;
    }
    lines.push(`  ${task}: no completed runs`);
  }
  const total = record.results.length;
  const passedCount = record.results.filter((result) => result.verify?.passed === true).length;
  const failedCount = record.results.filter((result) => result.verify?.passed === false).length;
  const timedOut = record.results.filter((result) => result.status === "timeout").length;
  const errored = record.results.filter(
    (result) => result.status === "error" || result.status === "setup_failed",
  ).length;
  const unverified = record.results.filter(
    (result) => result.verify === null && result.status === "completed",
  ).length;
  const wall = Date.parse(record.endedAt) - Date.parse(record.startedAt);
  lines.push("");
  lines.push(
    `  totals: ${total} combos, ${passedCount} passed, ${failedCount} failed, ${timedOut} timed out, ` +
      `${errored} errored, ${unverified} unverified — wall ${Number.isFinite(wall) ? formatDuration(wall) : "-"}`,
  );
  return lines;
}