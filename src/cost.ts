import type { CostInfo } from "./types.js";

const PREFIX = "ARENA_COST:";

export function parseCost(stdout: string): CostInfo | null {
  const lines = stdout.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line.startsWith(PREFIX)) continue;
    return parseLine(line);
  }
  return null;
}

function parseLine(line: string): CostInfo | null {
  const payload = line.slice(PREFIX.length).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed === "number" && Number.isFinite(parsed)) {
    return { usd: parsed, raw: line };
  }
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    const info: CostInfo = { raw: line };
    if (typeof record.usd === "number" && Number.isFinite(record.usd)) {
      info.usd = record.usd;
    }
    const tokens = record.tokens;
    if (typeof tokens === "number" && Number.isFinite(tokens)) {
      info.tokens = tokens;
    } else if (typeof tokens === "object" && tokens !== null && !Array.isArray(tokens)) {
      const kept: Record<string, number> = {};
      for (const [key, value] of Object.entries(tokens as Record<string, unknown>)) {
        if (typeof value === "number" && Number.isFinite(value)) kept[key] = value;
      }
      if (Object.keys(kept).length > 0) info.tokens = kept;
    }
    if (info.usd === undefined && info.tokens === undefined) return null;
    return info;
  }
  return null;
}