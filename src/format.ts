import type { CostInfo } from "./types.js";

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const restSeconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m${String(restSeconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatCost(cost: CostInfo | null): string {
  if (!cost) return "-";
  if (typeof cost.usd === "number") return `$${cost.usd.toFixed(2)}`;
  if (typeof cost.tokens === "number") return `${cost.tokens} tok`;
  if (cost.tokens) {
    const total = Object.values(cost.tokens).reduce((sum, value) => sum + value, 0);
    return `${total} tok`;
  }
  return "-";
}