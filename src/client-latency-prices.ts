import type { ProbeServer } from "./types";
import type { PriceCard } from "./emerald-model";

type ClientGroupPrice = Pick<ProbeServer, "renewal_price" | "renewal_price_cny" | "renewal_currency" | "renewal_cycle" | "expires_at" | "region_country" | "region_name" | "region_city"> & {
  // A calendar date does not imply a particular expiry time.
  expiry_date?: string;
};

export function clientGroupDateRemaining(date: string, now: number): PriceCard | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match || !Number.isFinite(now)) return undefined;
  const [, year, month, day] = match;
  const target = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (new Date(target).toISOString().slice(0, 10) !== date) return undefined;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (name: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === name)?.value);
  const today = Date.UTC(part("year"), part("month") - 1, part("day"));
  const days = (target - today) / 86400000;
  return {
    label: "剩余时间",
    value: days < 0 ? `${date}（已过到期日）` : days === 0 ? `${date}（到期日）` : `${days} 天 · ${date}`,
    tone: days > 7 ? "positive" : "warning",
    title: `到期日期：${date}（具体时间未知）`,
  };
}

// Public, non-secret metadata, keyed by the confirmed persistent client group ID.
export const bwhUsGroupId = "8a0929c0a3e3ad68ff8be667470b45ca";
const clientGroupPrices: Record<string, ClientGroupPrice> = {
  [bwhUsGroupId]: {
    renewal_price_cny: 80,
    renewal_cycle: "year",
    expires_at: "2027-11-11T00:00:00+08:00",
    region_country: "US",
    region_name: "美国",
    region_city: "洛杉矶",
  },
};

// Synthetic local integration group only; never applied to a deployed page.
const previewGroupPrices: Record<string, ClientGroupPrice> = {};

export function clientGroupPrice(groupId: string, preview: boolean): ClientGroupPrice | undefined {
  return (preview ? previewGroupPrices[groupId] : undefined) ?? clientGroupPrices[groupId];
}
