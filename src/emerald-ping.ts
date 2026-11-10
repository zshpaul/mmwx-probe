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
export function pingSummary(series: ProbePingSeries[], timing?: Pick<PingResponse, "generated_at" | "bucket_sec">) {
  const count = Math.max(0, ...series.map(item => item.buckets?.length || 0));
  const bucket = timing?.bucket_sec;
  const endTime = validLatency(timing?.generated_at) && validLatency(bucket) && bucket > 0 ? Math.floor(timing.generated_at / bucket) * bucket : undefined;
  const points = Array.from({ length: count }, (_, index) => {
    const buckets = series.map(item => item.buckets?.[index - (count - (item.buckets?.length || 0))]);
    return {
      time: endTime === undefined ? undefined : endTime - (count - 1 - index) * bucket!,
      latency: average(buckets.map(point => point && validLatency(point.ms) && validLoss(point.loss) && point.loss < 100 ? point.ms : undefined)),
      loss: average(buckets.map(point => point && validLoss(point.loss) ? point.loss : undefined)),
    };
  });
  const barCount = Math.min(10, count) || 10;
  const bars = Array.from({ length: barCount }, (_, index) => {
    const start = Math.floor(index * count / barCount);
    const end = Math.floor((index + 1) * count / barCount);
    const firstTime = points[0]?.time;
    const lastTime = points.at(-1)?.time;
    const size = firstTime === undefined || lastTime === undefined ? undefined : Math.max(.001, (lastTime - firstTime) / barCount);
    const time = size === undefined ? undefined : firstTime! + index * size;
    const segmentEnd = size === undefined ? undefined : index === barCount - 1 ? lastTime! + .001 : time! + size;
    const segment = time === undefined ? points.slice(start, end) : points.filter(point => point.time! >= time && point.time! < segmentEnd!);
    return { start, end, time, latency: average(segment.map(point => point.latency)), loss: average(segment.map(point => point.loss)) };
  });
  return { bars, latency: average(points.map(point => point.latency)), loss: average(points.map(point => point.loss)) };
}
export function pingSampleTooltip(time: number | undefined, value: number | undefined, metric: "latency" | "loss") {
  const date = time === undefined ? undefined : new Date(time * 1000);
  const label = date && Number.isFinite(date.getTime()) ? [date.getHours(), date.getMinutes(), date.getSeconds()].map(part => String(part).padStart(2, "0")).join(":") : undefined;
  if (!label) return "时间未知";
  return value === undefined ? `${label} N/A` : `${label}\n${metric === "latency" ? `${Math.round(value)} ms` : `${value.toFixed(1)}%`}`;
}
export type PingResponse = { success?: boolean; generated_at?: number; bucket_sec?: number; buckets?: number; series?: ProbePingSeries; all_series?: ProbePingSeries[] };
export async function fetchPingHistory(index: number, range: DetailRange, signal: AbortSignal): Promise<PingResponse> {
  const body = await requestJson<PingResponse>(`/api/series?server=${index}&range=${requestRange(range)}&all=1`, { signal, cache: "no-store" });
  const series = body?.all_series ?? (body?.series ? [{ ...body.series, key: "__avg__", label: "平均" }] : undefined);
  if (!body || body.success === false || !Array.isArray(series) || series.some(item => !item || !Array.isArray(item.buckets) || item.buckets.some(point => !point || typeof point.ms !== "number" || typeof point.loss !== "number"))) throw new Error("Invalid ping history");
  if (!validLatency(body.generated_at) || !validLatency(body.bucket_sec) || body.bucket_sec === 0) throw new Error("Missing ping timing");
  return { ...body, all_series: series };
}
export function pingHistoryRows(response: PingResponse | undefined, hours: number) {
  if (!response || !validLatency(response.generated_at) || !validLatency(response.bucket_sec) || response.bucket_sec === 0) return [];
  const count = Math.max(0, ...(response.all_series || []).map(series => series.buckets.length));
  if (count === 0 || count > 10000) return [];
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
