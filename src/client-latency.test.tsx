import { isIsolatedPoint } from "./Trend";
import { clientLatencyRows } from "./ClientLatency";
import { bwhUsGroupId, clientGroupPrice } from "./client-latency-prices";
import { priceCards } from "./emerald-model";
const equal = (actual: unknown, expected: unknown) => {
  if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
};

const sample = {
  group_id: "g", group_alias: "公开组", node: "公开节点", status: "ok" as const,
  delay_ms: 50, segment: "a", measured_at: "2026-11-13T00:00:00Z",
};
const rows = clientLatencyRows([
  sample,
  { ...sample, measured_at: "2026-11-13T00:01:00Z", delay_ms: 60 },
  { ...sample, measured_at: "2026-11-13T00:02:00Z", segment: "b" },
  { ...sample, measured_at: "2026-11-13T00:03:00Z", segment: "b", status: "failed", delay_ms: null },
  { ...sample, measured_at: "2026-11-13T00:10:00Z", segment: "b" },
]);
equal(rows[0].time, Date.parse(sample.measured_at) / 1000);
equal(rows[1].latency, 60);
equal(rows[2].latency, null); // segment change
equal(rows[4].latency, null); // failed measurement
equal(rows[5].latency, null); // long missing interval

const bwhPrice = clientGroupPrice(bwhUsGroupId, false)!;
const demoCards = priceCards(bwhPrice, Date.parse("2027-11-09T16:00:00Z"));
equal(demoCards.find(card => card.label === "节点价格")?.value, "¥80.00");
equal(demoCards.find(card => card.label === "节点价格")?.unit, "CNY / 年");
equal(demoCards.find(card => card.label === "剩余时间")?.value, "1");
equal(bwhPrice.region_country, "US");
equal(bwhPrice.region_city, "洛杉矶");
equal(clientGroupPrice("group_123", true), undefined);
equal(clientGroupPrice("other", true), undefined);

const isolated = Array.from({ length: 101 }, (_, i) => ({ ...sample, measured_at: new Date(Date.parse(sample.measured_at) + i * 360_000).toISOString() }));
const isolatedRows = clientLatencyRows(isolated);
equal(isolatedRows.length, 201);
equal(isolatedRows.filter((_, i) => isIsolatedPoint(isolatedRows, "latency", i)).length, 101);
