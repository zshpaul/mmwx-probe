import { renderToStaticMarkup } from "react-dom/server";
import { EmeraldPingSummary } from "./EmeraldPing";
import { pingSummary, pingHistoryRows, pingSampleTooltip, pingTone, smoothPingRows } from "./emerald-ping";
import { financeSummary } from "./emerald-model";
import type { ProbeServer } from "./types";

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
const server: ProbeServer = { name: "Example", online: true, ping: [
  { isp: "telecom", label: "电信", current_ms: 20, loss_pct: 0, buckets: [{ ms: 10, loss: 0 }, { ms: -1, loss: 100 }] },
  { isp: "unicom", label: "联通", current_ms: 40, loss_pct: 0, buckets: [{ ms: 30, loss: 0 }, { ms: 40, loss: 0 }] },
] };
const stats = pingSummary(server.ping!);
check(stats.latency === 30 && stats.loss === 25, "Timeout must contribute loss without inventing latency");
check(stats.bars[1].latency === 40 && stats.bars[1].loss === 50, "Aligned carrier sampling failed");
const missing = pingSummary([{ label: "Missing", current_ms: -1, loss_pct: -1, buckets: [{ ms: -1, loss: -1 }] }]);
check(missing.latency === undefined && missing.loss === undefined, "Missing data must not become zero");
check(pingSummary([]).bars.length === 10, "Empty display must retain ten muted slots");
check(pingTone(240, "latency") === "level-3" && pingTone(9.1, "loss") === "level-4", "Emerald thresholds changed");
const markup = renderToStaticMarkup(<EmeraldPingSummary server={server} onOpen={() => {}} />);
for (const text of ["三网", "20ms", "40ms", "—", "加载中", "Example 延迟"]) check(markup.includes(text), `Missing card content: ${text}`);
check(!markup.includes("采样 1"), "Sequence tooltip must not remain");
const timed = pingSummary(server.ping!, { generated_at: 36059, bucket_sec: 1800 });
check(timed.bars[0].time === 34200 && timed.bars[1].time === 35100, "Segments must use time boundaries, not last samples");
const clock = new Date(2026, 10, 10, 9, 8, 7).getTime() / 1000;
check(pingSampleTooltip(clock, 165.8, "latency") === "09:08:07\n166 ms", "Local latency time format");
check(pingSampleTooltip(clock, 2.54, "loss") === "09:08:07\n2.5%", "Local loss time format");
check(pingSampleTooltip(clock, undefined, "loss") === "09:08:07 N/A", "Missing loss");
check(pingSampleTooltip(clock, undefined, "latency") === "09:08:07 N/A", "Missing latency");
check(pingSampleTooltip(undefined, 1, "latency") === "时间未知", "Do not invent a timestamp");
const many = pingSummary([{ label: "test", current_ms: 1, loss_pct: 0, buckets: Array.from({ length: 12 }, (_, index) => ({ ms: index, loss: 0 })) }], { generated_at: 36000, bucket_sec: 300 });
check(many.bars.length === 10 && many.bars[1].time === 33030 && many.bars[0].latency === .5, "Time segmentation must match Emerald");
check(!renderToStaticMarkup(<EmeraldPingSummary server={{ ...server, online: false }} onOpen={() => {}} />).includes("20ms"), "Offline current values must not look live");
const rows = pingHistoryRows({ generated_at: 36000, bucket_sec: 1800, buckets: 2, all_series: server.ping }, 12);
check(rows.length === 2 && rows[0].time === 34200 && rows[1].latency0 === null && rows[1].loss0 === 100, "History time metadata or loss gap failed");
check(pingHistoryRows({ all_series: server.ping }, 1).length === 0, "No timestamps may be invented");
const smoothed = smoothPingRows([{ latency0: 10 }, { latency0: null }, { latency0: 20 }], ["latency0"]);
check(smoothed[1].latency0 === null && smoothed[2].latency0 === 20, "Smoothing must preserve missing samples");
const now = Date.parse("2026-11-10T00:00:00Z");
const finance = financeSummary([
  { online: true, renewal_price_cny: 365, renewal_cycle: "year", expires_at: "2026-11-20T00:00:00Z" },
  { online: false, renewal_price: 100, renewal_currency: "USD", renewal_cycle: "year", expires_at: "2026-11-20T00:00:00Z" },
  { online: true, renewal_price: 99 },
], now);
check(finance.length === 2 && finance[0].remaining === 10 && finance[0].monthly === 30 && finance[1].currency === "USD", "Currency separation or remaining value calculation failed");
check(financeSummary([{ online: true, renewal_price_cny: 99 }], now)[0].periodic === 0, "Unknown billing cycle must not imply a measured zero monthly cost");
