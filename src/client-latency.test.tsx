import { isIsolatedPoint } from "./Trend";
import { clientLatencyRows, clientPresence, ClientLatencyList } from "./ClientLatency";
import { bwhUsGroupId, clientGroupPrice } from "./client-latency-prices";
import { readRateSnapshot } from "./client-rate";
import { priceCards } from "./emerald-model";
import { ServerCard } from "./App";
import { renderToStaticMarkup } from "react-dom/server";
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

const now = Date.parse("2026-11-13T00:10:00Z");
const group = { id: bwhUsGroupId, alias: "BWH-US", samples: [{ ...sample, group_id: bwhUsGroupId }] };
const activeRate = { version: 1, expires_in_ms: 30_000, snapshot: { group_id: bwhUsGroupId, observed_at: "2026-11-13T00:09:59Z", status: "unknown", upload_bps: null, download_bps: null } };
const live = readRateSnapshot(activeRate, 100);
equal(live.presence.state, "online");
equal(live.rate, undefined);
equal(clientPresence(group, now, true, live.presence), "online"); // Old or failed URLTest is not a stopped client.
const stale = readRateSnapshot({ ...activeRate, expires_in_ms: 0 }, 0);
equal(stale.presence.state, "offline");
equal(clientPresence(group, now, true, stale.presence), "offline");
equal(clientPresence(group, now, false, { state: "unknown" }), "unknown");
equal(readRateSnapshot({ ...activeRate, snapshot: null }, 0).presence.state, "unknown");
equal(readRateSnapshot(activeRate, 30_000).presence.state, "offline");
const newer = { ...group, samples: [{ ...group.samples[0], measured_at: "2026-11-13T00:10:00Z", status: "failed" as const, delay_ms: null }] };
equal(clientPresence(newer, now, true, stale.presence), "online"); // A newer failed measurement is still a report.
equal(clientPresence(newer, now + 31_000, true, stale.presence), "offline");
equal(clientPresence(newer, now + 31_000, true, { state: "unknown", observedAt: stale.presence.observedAt }), "unknown");
const future = { ...newer, samples: [{ ...newer.samples[0], measured_at: "2026-11-13T00:15:00Z" }] };
equal(clientPresence(future, now, true, stale.presence), "offline"); // Accepted clock skew is not evidence of a live client.
equal(clientPresence({ ...future, id: "other" }, now, true, { state: "unknown" }), "unknown");
equal(clientPresence(future, now, true, live.presence), "online"); // A fresh rate report remains authoritative.
const offlineMarkup = renderToStaticMarkup(<ServerCard group={group} clientState="offline" index={0} now={now} onPing={() => {}} />);
equal(offlineMarkup.includes('server-card offline'), true);
equal(offlineMarkup.includes("离线"), true);
equal(offlineMarkup.includes("查看历史"), true);
const onlineMarkup = renderToStaticMarkup(<ServerCard group={group} clientState="online" index={0} now={now} onPing={() => {}} />);
equal(onlineMarkup.includes('server-card offline'), false);
const unknownList = renderToStaticMarkup(<ClientLatencyList groups={[group]} now={now} available={false} ratePresence={{ state: "unknown" }} onOpen={() => {}} />);
equal(unknownList.includes("状态未知"), true);
