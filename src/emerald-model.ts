import type { ProbeServer } from "./types";
import type { ProbeMetricPoint } from "./conn-sparkline";
import { probeRangeBucketCount, probeRangeBucketSec } from "./probe-ranges";
import { resourceHistoryFromSeries, type ResourceSeriesInput } from "./resource-history";

export const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const ratio = (used?: number, total?: number) => isNumber(used) && isNumber(total) && total > 0 ? Math.min(100, Math.max(0, used / total * 100)) : undefined;
export const percent = (value?: number) => isNumber(value) ? `${value.toFixed(1)}%` : "—";
export function bytes(value?: number, base = 1024) {
  if (!isNumber(value)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let amount = Math.max(0, value), unit = 0;
  while (amount >= base && unit < units.length - 1) { amount /= base; unit++; }
  return `${amount.toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
}
export const speed = (value?: number) => isNumber(value) ? `${bytes(value)}/s` : "—";
export const locationName = (server: ProbeServer) => [server.region_name || server.region || server.region_country, server.region_city].filter(Boolean).join(" · ");
export function uptime(value?: number) {
  if (!isNumber(value) || value < 0) return undefined;
  const days = Math.floor(value / 86400);
  const hours = Math.floor(value % 86400 / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  return `${days ? `${days} 天 ` : ""}${hours ? `${hours} 小时 ` : ""}${!days && !hours ? `${minutes} 分钟` : ""}`.trim();
}
export const cycleNames = { month: "月", quarter: "季度", half_year: "半年", year: "年", two_year: "两年", three_year: "三年", permanent: "永久" };
const cycleDays = { month: 30, quarter: 90, half_year: 180, year: 365, two_year: 730, three_year: 1095, permanent: 0 };
const symbols: Record<string, string> = { CNY: "¥", USD: "$", HKD: "HK$", EUR: "€", GBP: "£", JPY: "¥" };
export function financeSummary(servers: ProbeServer[], now: number) {
  const totals = new Map<string, { currency: string; total: number; monthly: number; remaining: number; priced: number; periodic: number; estimated: number }>();
  for (const server of servers) {
    const currency = isNumber(server.renewal_price_cny) ? "CNY" : server.renewal_currency;
    const price = isNumber(server.renewal_price_cny) ? server.renewal_price_cny : server.renewal_price;
    if (!currency || !isNumber(price) || price < 0) continue;
    const group = totals.get(currency) || { currency, total: 0, monthly: 0, remaining: 0, priced: 0, periodic: 0, estimated: 0 };
    group.total += price;
    group.priced++;
    const days = server.renewal_cycle ? cycleDays[server.renewal_cycle] : undefined;
    const expiry = Date.parse(server.expires_at || "");
    if (days) {
      group.periodic++;
      group.monthly += price / days * 30;
      if (Number.isFinite(expiry)) {
        group.remaining += price * Math.max(0, (expiry - now) / 86400000) / days;
        group.estimated++;
      }
    }
    totals.set(currency, group);
  }
  return [...totals.values()];
}
export type PriceCard = { label: string; value: string; unit?: string; title?: string; tone?: string };
export function priceCards(server: ProbeServer, now: number): PriceCard[] {
  const currency = isNumber(server.renewal_price_cny) ? "CNY" : server.renewal_currency;
  const price = isNumber(server.renewal_price_cny) ? server.renewal_price_cny : server.renewal_price;
  const hasPrice = isNumber(price) && price >= 0 && !!currency;
  const money = (amount: number) => `${symbols[currency!] || ""}${amount.toFixed(2)}`;
  const days = server.renewal_cycle ? cycleDays[server.renewal_cycle] : undefined;
  const expiration = server.expires_at ? Date.parse(server.expires_at) : NaN;
  const remaining = Number.isFinite(expiration) ? (expiration - now) / 86400000 : undefined;
  const cards: PriceCard[] = [];
  if (hasPrice) cards.push({ label: "节点价格", value: money(price), unit: `${currency}${server.renewal_cycle ? ` / ${cycleNames[server.renewal_cycle]}` : ""}` });
  if (hasPrice && days) cards.push({ label: "月均支出", value: money(price / days * 30), unit: `${currency} / 月`, title: `按 ${days} 天计费周期折算 30 天月均支出，非实际账单` });
  if (remaining !== undefined) cards.push({ label: "剩余时间", value: remaining <= 0 ? "已到期" : `${Math.ceil(remaining)}`, unit: remaining > 0 ? "天" : undefined, tone: remaining > 7 ? "positive" : "warning", title: `到期时间：${new Date(expiration).toLocaleString("zh-CN", { hour12: false })}` });
  else if (server.renewal_cycle === "permanent") cards.push({ label: "剩余时间", value: "长期" });
  if (hasPrice && days && remaining !== undefined) cards.push({ label: "剩余价值", value: money(price * Math.max(0, remaining) / days), unit: currency, title: `按剩余天数 / ${days} 天周期估算，非可退款金额` });
  return cards;
}

export const detailRanges = ["1h", "6h", "12h", "24h"] as const;
export type DetailRange = typeof detailRanges[number];
export const requestRange = (range: DetailRange) => range === "12h" ? "24h" : range;
export type SystemResponse = {
  success?: boolean;
  generated_at?: number;
  bucket_sec?: number;
  buckets?: number;
  series?: ResourceSeriesInput & Record<string, ProbeMetricPoint[] | undefined>;
};
export type ChartRow = Record<string, number | null>;
export function historyRows(system: SystemResponse | undefined, range: DetailRange, now = Date.now() / 1000): ChartRow[] {
  const requested = requestRange(range);
  const bucket = isNumber(system?.bucket_sec) && system.bucket_sec > 0 ? system.bucket_sec : probeRangeBucketSec(requested);
  const count = isNumber(system?.buckets) && system.buckets > 0 ? Math.min(10000, Math.floor(system.buckets)) : probeRangeBucketCount(requested);
  const generated = isNumber(system?.generated_at) ? system.generated_at : Math.floor(now);
  const resource = resourceHistoryFromSeries(system?.series, generated, bucket, count);
  const keys = ["mem_used", "disk_used", "upload_speed", "download_speed", "tcp_connections", "udp_connections"];
  const maps = Object.fromEntries(keys.map(key => [key, new Map(system?.series?.[key]?.map(point => [point.t, point.value]))]));
  const end = resource.times.at(-1) ?? generated;
  const start = end - Number.parseInt(range, 10) * 3600;
  return resource.times.flatMap((time, index) => {
    if (time <= start) return [];
    const row: ChartRow = { time, cpu: isNumber(resource.cpu[index]) ? resource.cpu[index] : null };
    for (const key of keys) {
      const value = maps[key].get(time);
      row[key] = isNumber(value) && value >= 0 ? value / (key.endsWith("_used") ? 1024 ** 3 : key.endsWith("_speed") ? 1024 ** 2 : 1) : null;
    }
    return [row];
  });
}
