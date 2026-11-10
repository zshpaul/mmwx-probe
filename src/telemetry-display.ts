import type { ProbeBucket, ProbeReturnRoute } from "./types";

export function latestReturnRoute(routes: ProbeReturnRoute[] | undefined, isp?: string): ProbeReturnRoute | undefined {
  if (!isp || !["telecom", "unicom", "mobile"].includes(isp)) return undefined;
  const candidates = routes?.filter(route => route.carrier === isp) || [];
  const timestamp = (route: ProbeReturnRoute) => {
    const parsed = Date.parse(route.tested_at || "");
    return Number.isFinite(parsed) ? parsed : -Infinity;
  };
  return candidates.reduce<ProbeReturnRoute | undefined>((latest, route) => !latest || timestamp(route) > timestamp(latest) ? route : latest, undefined);
}

export function loadAverage(value?: string | null): string | undefined {
  if (!value?.trim()) return undefined;
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 3 && parts.length !== 5) return value;
  if (parts.length === 5 && (!/^\d+\/\d+$/.test(parts[3]) || !/^\d+$/.test(parts[4]))) return value;
  const loads = parts.slice(0, 3);
  if (!loads.every(part => /^\d+(?:\.\d+)?$/.test(part) && Number.isFinite(Number(part)))) return value;
  return loads.map(part => Number(part).toFixed(2)).join(", ");
}

export function loadAverageTitle(value?: string): string | undefined {
  const formatted = loadAverage(value);
  return formatted && formatted !== value ? `${formatted}\n${value}` : value;
}

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
