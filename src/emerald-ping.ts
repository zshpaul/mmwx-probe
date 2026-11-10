import type { ProbeBucket, ProbePingSeries } from "./types";
import { requestJson } from "./request-json";
import { requestRange, type DetailRange } from "./emerald-model";

export const validLatency = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
export const validLoss = (value: unknown): value is number => validLatency(value) && value <= 100;
export function average(values: (number | undefined | null)[]) {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return present.length ? present.reduce((total, value) => total + value, 0) / present.length : undefined;
}
export function pingTone(value: number | undefined, metric: "latency" | "loss") {
  if (value === undefined) return "missing";
  const thresholds = metric === "latency" ? [60, 120, 180, 240] : [1, 3, 6, 9];
  const level = thresholds.findIndex(threshold => value <= threshold);
  return `level-${level < 0 ? 4 : level}`;
}
export function pingSummary(series: ProbePingSeries[]) {
  const count = Math.max(0, ...series.map(item => item.buckets?.length || 0));
  const points = Array.from({ length: count }, (_, index) => {
    const buckets = series.map(item => item.buckets?.[index - (count - (item.buckets?.length || 0))]);
    return {
      latency: average(buckets.map(point => point && validLatency(point.ms) && validLoss(point.loss) && point.loss < 100 ? point.ms : undefined)),
      loss: average(buckets.map(point => point && validLoss(point.loss) ? point.loss : undefined)),
    };
  });
  const barCount = Math.min(10, count) || 10;
  const bars = Array.from({ length: barCount }, (_, index) => {
    const start = Math.floor(index * count / barCount);
    const end = Math.floor((index + 1) * count / barCount);
    const segment = points.slice(start, end);
    return { start, end, latency: average(segment.map(point => point.latency)), loss: average(segment.map(point => point.loss)) };
  });
  return { bars, latency: average(points.map(point => point.latency)), loss: average(points.map(point => point.loss)) };
}
export type PingResponse = { success?: boolean; generated_at?: number; bucket_sec?: number; buckets?: number; series?: ProbePingSeries; all_series?: ProbePingSeries[] };
export async function fetchPingHistory(index: number, range: DetailRange, signal: AbortSignal): Promise<PingResponse> {
  const body = await requestJson<PingResponse>(`/api/series?server=${index}&range=${requestRange(range)}&all=1`, { signal, cache: "no-store" });
  const series = body?.all_series ?? (body?.series ? [{ ...body.series, key: "__avg__", label: "平均" }] : undefined);
  if (!body || body.success === false || !Array.isArray(series) || series.some(item => !item || !Array.isArray(item.buckets) || item.buckets.some(point => !point || typeof point.ms !== "number" || typeof point.loss !== "number"))) throw new Error("Invalid ping history");
  return { ...body, all_series: series };
}
export function pingHistoryRows(response: PingResponse | undefined, hours: number) {
  if (!response || !validLatency(response.generated_at) || !validLatency(response.bucket_sec) || response.bucket_sec === 0 || !Number.isInteger(response.buckets) || response.buckets! <= 0 || response.buckets! > 10000) return [];
  const count = response.buckets!;
  const end = Math.floor(response.generated_at / response.bucket_sec) * response.bucket_sec;
  return Array.from({ length: count }, (_, index) => {
    const row: Record<string, number | null> = { time: end - (count - 1 - index) * response.bucket_sec! };
    response.all_series?.forEach((series, seriesIndex) => {
      const point: ProbeBucket | undefined = series.buckets?.[index - (count - series.buckets.length)];
      row[`latency${seriesIndex}`] = point && validLatency(point.ms) && validLoss(point.loss) && point.loss < 100 ? point.ms : null;
      row[`loss${seriesIndex}`] = point && validLoss(point.loss) ? point.loss : null;
    });
    return row;
  }).filter(row => row.time! > end - hours * 3600);
}
export function smoothPingRows(rows: Record<string, number | null>[], keys: string[]) {
  const previous: Record<string, number | undefined> = {};
  return rows.map(row => {
    const next = { ...row };
    for (const key of keys) {
      const value = row[key];
      if (value === null || value === undefined) { previous[key] = undefined; continue; }
      next[key] = previous[key] === undefined ? value : .3 * value + .7 * previous[key]!;
      previous[key] = next[key]!;
    }
    return next;
  });
}
