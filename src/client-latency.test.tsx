import { isIsolatedPoint } from "./Trend";
import { clientLatencyInRange, clientLatencyRows, clientPresence, ClientLatencyDialog, ClientLatencyList } from "./ClientLatency";
import { bwhUsGroupId, clientGroupDateRemaining, clientGroupPrice, dmitUsGroupId } from "./client-latency-prices";
import { readRateSnapshot } from "./client-rate";
import { quotaUsage } from "./client-quota";
import { priceCards } from "./emerald-model";
import { availableConfiguredGroups, configuredClientGroup, configuredClientGroups, ServerCard } from "./App";
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

const rangeNow = Date.parse("2026-11-14T00:00:00Z");
const at = (offset: number) => ({ ...sample, measured_at: new Date(rangeNow + offset).toISOString() });
const rangeSamples = [at(-24 * 3600_000 - 1), at(-24 * 3600_000), at(-12 * 3600_000), at(-6 * 3600_000), at(-3600_000 - 1), at(-3600_000), at(0), at(1), { ...sample, measured_at: "invalid" }];
for (const [range, expected] of [["1h", 2], ["6h", 4], ["12h", 5], ["24h", 6]] as const) {
  equal(clientLatencyInRange(rangeSamples, range, rangeNow).length, expected);
}
equal(clientLatencyInRange([at(-3600_000 - 1)], "1h", rangeNow).length, 0);
const retainedDuringRetry = [at(-3600_000 + 30_000)];
equal(clientLatencyInRange(retainedDuringRetry, "1h", rangeNow).length, 1);
equal(clientLatencyInRange(retainedDuringRetry, "1h", rangeNow + 60_000).length, 0);
const filteredGaps = clientLatencyRows(clientLatencyInRange([
  at(-600_000), { ...at(-540_000), status: "failed", delay_ms: null }, at(-60_000), at(0),
], "1h", rangeNow));
equal(filteredGaps[1].latency, null);
equal(filteredGaps[2].latency, null);
const dialogMarkup = renderToStaticMarkup(<ClientLatencyDialog group={{ id: "g", alias: "BWH-US", samples: [] }} onClose={() => {}} />);
for (const range of ["1H", "6H", "12H", "24H"]) equal(dialogMarkup.includes(`>${range}</button>`), true);
equal(dialogMarkup.includes('aria-pressed="true">1H</button>'), true);

const bwhPrice = clientGroupPrice(bwhUsGroupId, false)!;
const demoCards = priceCards(bwhPrice, Date.parse("2027-11-09T16:00:00Z"));
equal(demoCards.find(card => card.label === "节点价格")?.value, "¥80.00");
equal(demoCards.find(card => card.label === "节点价格")?.unit, "CNY / 年");
equal(demoCards.find(card => card.label === "剩余时间")?.value, "1");
equal(bwhPrice.region_country, "US");
equal(bwhPrice.region_city, "洛杉矶");
equal(clientGroupPrice("group_123", true), undefined);
equal(clientGroupPrice("other", true), undefined);
equal(clientGroupDateRemaining("2027-11-21", Date.parse("2027-11-20T15:59:59Z"))?.value, "1 天 · 2027-11-21");
equal(clientGroupDateRemaining("2027-11-21", Date.parse("2027-11-20T16:00:00Z"))?.value, "2027-11-21（到期日）");
equal(clientGroupDateRemaining("2027-11-21", Date.parse("2027-11-21T16:00:00Z"))?.value, "2027-11-21（已过到期日）");
equal(clientGroupDateRemaining("2027-11-21", Date.parse("2027-11-20T16:00:00Z"))?.title, "到期日期：2027-11-21（具体时间未知）");
equal(clientGroupDateRemaining("2027-02-30", Date.now()), undefined);

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
equal(clientPresence(newer, now, true, stale.presence), "offline"); // A client timestamp cannot override a server-expired report.
equal(clientPresence(newer, now + 31_000, true, stale.presence), "offline");
equal(clientPresence(newer, now + 31_000, true, { state: "unknown", observedAt: stale.presence.observedAt }), "unknown");
const future = { ...newer, samples: [{ ...newer.samples[0], measured_at: "2026-11-13T00:15:00Z" }] };
equal(clientPresence(future, now, true, stale.presence), "offline"); // Accepted clock skew is not evidence of a live client.
equal(clientPresence({ ...future, id: "other" }, now, true, { state: "unknown" }), "unknown");
equal(clientPresence(future, now, true, live.presence), "online"); // A fresh rate report remains authoritative.
equal(clientPresence(future, now + 300_000, true, stale.presence), "offline"); // Catching up to the timestamp cannot revive an old report.
equal(clientPresence({ ...future, id: "other" }, now + 300_000, true, { state: "unknown" }), "unknown");
const offlineMarkup = renderToStaticMarkup(<ServerCard group={group} clientState="offline" index={0} now={now} onPing={() => {}} />);
equal(offlineMarkup.includes('server-card offline'), true);
equal(offlineMarkup.includes("离线"), true);
equal(offlineMarkup.includes("查看历史"), true);
const onlineMarkup = renderToStaticMarkup(<ServerCard group={group} clientState="online" index={0} now={now} onPing={() => {}} />);
equal(onlineMarkup.includes('server-card offline'), false);
const unknownList = renderToStaticMarkup(<ClientLatencyList groups={[group]} now={now} available={false} ratePresence={{ state: "unknown" }} onOpen={() => {}} />);
equal(unknownList.includes("状态未知"), true);

// A configured identity appears only with real evidence and retains an empty history when no sample exists.
const configured = { id: "independent", alias: "new group" };
equal(configuredClientGroup(configured), undefined);
const configuredEntries = [{ ...configured, quotaMode: "download" as const }];
equal(availableConfiguredGroups(configuredEntries, [], {}).length, 0);
equal(availableConfiguredGroups(configuredEntries, [], { [configured.id]: { presence: { state: "unknown" } } }).length, 0);
equal(availableConfiguredGroups(configuredEntries, [], { [configured.id]: { presence: { state: "online", observedAt: "2026-11-13T00:09:59Z" } } }).length, 1);
const noLatency = configuredClientGroup(configured, undefined, undefined, "2026-11-13T00:09:59Z")!;
equal(noLatency.samples.length, 0);
equal(noLatency.alias, configured.alias);
const quota = { version: 1 as const, group_id: configured.id, revision: 1, updated_at: "2026-11-13T00:09:59Z", upload_bytes: 1024, download_bytes: 2048, total_bytes: 8192, expires_at: null };
const dmitConfig = configuredClientGroups.find(item => item.id === dmitUsGroupId)!;
equal(dmitConfig.alias, "dmitus");
equal(dmitConfig.quotaEnabled, false);
const dmitQuota = { ...quota, group_id: dmitUsGroupId };
equal(availableConfiguredGroups([dmitConfig], [], { [dmitUsGroupId]: { quota: dmitQuota, presence: { state: "unknown" } } }).length, 0);
const dmitEntries = availableConfiguredGroups([dmitConfig], [], { [dmitUsGroupId]: { quota: dmitQuota, presence: { state: "online", observedAt: quota.updated_at } } });
equal(dmitEntries.length, 1);
equal(dmitEntries[0].snapshot?.quota, undefined);
const dmitMarkup = renderToStaticMarkup(<ServerCard group={dmitEntries[0].group} clientState="online" hasClientRate showUnknownQuota index={0} now={now} onPing={() => {}} />);
equal(dmitMarkup.includes("dmitus"), true);
equal(dmitMarkup.includes("¥120.00"), true);
equal(dmitMarkup.includes("2027-11-21"), true);
equal(dmitMarkup.includes("具体时间未知"), true);
equal(dmitMarkup.includes(">未知</p>"), true);
equal(dmitMarkup.includes("洛杉矶"), false);
equal(configuredClientGroup(configured, undefined, quota)?.samples.length, 0);
const independentRate = { ...activeRate, snapshot: { ...activeRate.snapshot, group_id: configured.id } };
equal(readRateSnapshot(independentRate, 0, configured.id).presence.state, "online");
let rejectedWrongGroup = false;
try { readRateSnapshot(independentRate, 0, bwhUsGroupId); } catch { rejectedWrongGroup = true; }
equal(rejectedWrongGroup, true);
const configuredMarkup = renderToStaticMarkup(<ServerCard group={noLatency} clientState="online" hasClientRate showUnknownQuota rate={{ observed_at: "2026-11-13T00:09:59Z", upload_bps: 1024, download_bps: 2048 }} index={0} now={now} onPing={() => {}} />);
equal(configuredMarkup.includes("new group"), true);
equal(configuredMarkup.includes("CNY / 年"), false);
equal(configuredMarkup.includes("1 KB/s"), true);
equal(configuredMarkup.includes("2 KB/s"), true);
equal(configuredMarkup.includes(">未知</p>"), true);
const quotaMarkup = renderToStaticMarkup(<ServerCard group={noLatency} quota={quota} index={0} now={now} onPing={() => {}} />);
equal(quotaMarkup.includes("3 KB / 8 KB"), true);
equal(quotaMarkup.includes("上传 1 KB"), true);
equal(quotaMarkup.includes("下载 2 KB"), true);
equal(quotaUsage(quota).used, 3072);
equal(quotaUsage(quota, "download").used, 2048);
equal(quotaUsage({ ...quota, upload_bytes: null }, "download").remaining, 6144);
equal(quotaUsage({ ...quota, download_bytes: null }, "download").used, undefined);
const downloadMarkup = renderToStaticMarkup(<ServerCard group={noLatency} quota={quota} quotaMode="download" index={0} now={now} onPing={() => {}} />);
equal(downloadMarkup.includes("2 KB / 8 KB"), true);
equal(downloadMarkup.includes("统计方式：仅下行"), true);
