import type { ProbeServer } from "./types";

type ClientGroupPrice = Pick<ProbeServer, "renewal_price" | "renewal_price_cny" | "renewal_currency" | "renewal_cycle" | "expires_at" | "region_country" | "region_name" | "region_city">;

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
