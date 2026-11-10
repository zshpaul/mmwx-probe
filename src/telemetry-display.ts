import type { ProbeBucket } from "./types";

export function cpuCoreUsage(percent?: number, cores?: number): string {
  if (!Number.isFinite(cores) || cores! <= 0) return "折合 — / — 核";
  if (!Number.isFinite(percent) || percent! < 0) return `折合 — / ${cores} 核`;
  return `折合 ${(Math.min(100, percent!) * cores! / 100).toFixed(2)} / ${cores} 核`;
}

export function pingState(point?: ProbeBucket): "missing" | "lost" | "partial" | "ok" {
  if (!point) return "missing";
  if (Number.isFinite(point.loss) && point.loss >= 100) return "lost";
  if (!Number.isFinite(point.ms) || point.ms < 0 || !Number.isFinite(point.loss) || point.loss < 0) return "missing";
  return point.loss > 0 ? "partial" : "ok";
}
