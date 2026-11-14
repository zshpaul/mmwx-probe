import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Activity, X } from "lucide-react";
import { requestJson } from "./request-json";
import { PingPanels, PingSummaryLayout } from "./EmeraldPing";
import { bwhUsGroupId } from "./client-latency-prices";
import type { RatePresence } from "./client-rate";
import { detailRanges, type DetailRange } from "./emerald-model";
const Trend = lazy(() => import("./Trend"));

export type ClientSample = {
  group_id: string;
  group_alias: string;
  measured_at: string;
  node: string | null;
  status: "ok" | "failed" | "unknown";
  delay_ms: number | null;
  segment: string;
};
export type ClientGroup = { id: string; alias: string; samples: ClientSample[] };

export function clientLatencyInRange(samples: ClientSample[], range: DetailRange, now: number) {
  const start = now - Number.parseInt(range, 10) * 3600_000;
  return samples.filter(sample => {
    const time = Date.parse(sample.measured_at);
    return time >= start && time <= now;
  });
}

export type ClientPresence = "online" | "offline" | "unknown";
export function clientPresence(group: ClientGroup, _now: number, _available: boolean, rate: RatePresence): ClientPresence {
  // Latency timestamps are supplied by the client and do not establish receipt time.
  // The rate endpoint's TTL is bounded by the server's actual receipt time.
  return group.id === bwhUsGroupId ? rate.state : "unknown";
}

export function clientLatencyRows(samples: ClientSample[]) {
  const rows: Record<string, number | null>[] = [];
  let previous: ClientSample | undefined;
  for (const sample of samples) {
    const time = Date.parse(sample.measured_at) / 1000;
    if (!Number.isFinite(time)) continue;
    if (previous) {
      const last = Date.parse(previous.measured_at) / 1000;
      if (sample.segment !== previous.segment || sample.node !== previous.node || time - last > 300) {
        rows.push({ time: (last + time) / 2, latency: null });
      }
    }
    rows.push({ time, latency: sample.status === "ok" && typeof sample.delay_ms === "number" ? sample.delay_ms : null });
    previous = sample;
  }
  return rows;
}

export function useClientLatency() {
  const [samples, setSamples] = useState<ClientSample[]>([]);
  const [available, setAvailable] = useState(false);
  const [checkedAt, setCheckedAt] = useState(Date.now);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const data = await requestJson<{ version: number; samples: ClientSample[] }>("/api/client-latency/v1/samples?summary=1", { signal: controller.signal, cache: "no-store" });
        if (data.version !== 1 || !Array.isArray(data.samples)) throw new Error("invalid response");
        if (active) { setSamples(data.samples); setAvailable(true); }
      } catch {
        if (active) setAvailable(false);
      } finally {
        if (active) setCheckedAt(Date.now());
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, []);
  const grouped = new Map<string, ClientSample[]>();
  for (const sample of samples) {
    const group = grouped.get(sample.group_id) || [];
    group.push(sample);
    grouped.set(sample.group_id, group);
  }
  return { groups: [...grouped].map(([id, entries]) => ({ id, alias: entries[entries.length - 1].group_alias, samples: entries })), available, checkedAt };
}

function status(sample?: ClientSample) {
  return sample?.status === "ok" && typeof sample.delay_ms === "number" ? `${Math.round(sample.delay_ms)} ms` : sample?.status === "failed" ? "测速失败" : "无数据";
}
function measuredTime(sample?: ClientSample) {
  if (!sample || !Number.isFinite(Date.parse(sample.measured_at))) return "暂无测量时间";
  return new Date(sample.measured_at).toLocaleString("zh-CN", { hour12: false });
}
export function ClientLatencySummary({ group, onOpen }: { group: ClientGroup; onOpen: () => void }) {
  const latest = group.samples.at(-1);
  const bars: { time?: number; latency?: number; tooltip?: string }[] = [];
  let previous: ClientSample | undefined;
  for (const sample of group.samples) {
    if (previous && (sample.segment !== previous.segment || sample.node !== previous.node || Date.parse(sample.measured_at) - Date.parse(previous.measured_at) > 300_000)) bars.push({ tooltip: "切换或缺测" });
    bars.push({ time: Date.parse(sample.measured_at) / 1000, latency: sample.status === "ok" ? sample.delay_ms ?? undefined : undefined, tooltip: `${measuredTime(sample)} · ${status(sample)}` });
    previous = sample;
  }
  const recent = bars.slice(-10);
  const padded = [...Array.from({ length: 10 - recent.length }, () => ({})), ...recent];
  return <PingSummaryLayout>
    <PingPanels name={group.alias} bars={padded} latency={latest?.status === "ok" ? latest.delay_ms ?? undefined : undefined}
      latencyText={latest?.status === "failed" ? "测速失败" : undefined} client onOpen={onOpen} />
  </PingSummaryLayout>;
}

export function ClientLatencyList({ groups, onOpen, available, now, ratePresence }: { groups: ClientGroup[]; onOpen: (id: string) => void; available: boolean; now: number; ratePresence: RatePresence }) {
  return <div className="client-list" aria-label="客户端代理延迟列表">{groups.map(group => {
    const presence = clientPresence(group, now, available, ratePresence);
    return <button key={group.id} className="client-list-row" onClick={() => onOpen(group.id)}>
      <span><Activity size={15} /><strong>{group.alias}</strong><small>客户端代理延迟</small></span><span>{presence === "offline" ? "离线" : presence === "unknown" ? "状态未知" : status(group.samples.at(-1))} · {measuredTime(group.samples.at(-1))}</span>
    </button>;
  })}</div>;
}

export function ClientLatencyDialog({ group, onClose }: { group: ClientGroup; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  const [history, setHistory] = useState<ClientSample[]>();
  const [historyError, setHistoryError] = useState<string>();
  const [range, setRange] = useState<DetailRange>("1h");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let loading = false;
    let after: number | undefined;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        if (after === undefined) {
          const pages: ClientSample[][] = [];
          const seen = new Set<string>();
          let cursor: string | null = null;
          let snapshot: number | undefined;
          do {
            const query = new URLSearchParams({ paged: "1", limit: "1000", group: group.id });
            if (cursor) query.set("cursor", cursor);
            const data = await requestJson<{ version: number; samples: ClientSample[]; next_cursor: string | null; snapshot: number }>(`/api/client-latency/v1/samples?${query}`, { signal: controller.signal, cache: "no-store" });
            if (data.version !== 1 || !Array.isArray(data.samples) || !Number.isSafeInteger(data.snapshot) || data.snapshot < 0 || (data.next_cursor !== null && typeof data.next_cursor !== "string")) throw new Error("invalid response");
            if (snapshot !== undefined && snapshot !== data.snapshot) throw new Error("snapshot changed");
            snapshot = data.snapshot;
            pages.push(data.samples);
            cursor = data.next_cursor;
            if (cursor && seen.has(cursor)) throw new Error("repeated cursor");
            if (cursor) seen.add(cursor);
          } while (cursor);
          after = snapshot;
          if (active) setHistory(pages.reverse().flatMap(page => page.reverse()));
        } else {
          const added: ClientSample[] = [];
          let next = after;
          let more: boolean;
          do {
            const query = new URLSearchParams({ after: String(next), limit: "1000", group: group.id });
            const data = await requestJson<{ version: number; samples: ClientSample[]; next_after: number; has_more: boolean }>(`/api/client-latency/v1/samples?${query}`, { signal: controller.signal, cache: "no-store" });
            if (data.version !== 1 || !Array.isArray(data.samples) || !Number.isSafeInteger(data.next_after) || data.next_after < next || typeof data.has_more !== "boolean" || (data.has_more && data.next_after === next)) throw new Error("invalid response");
            added.push(...data.samples);
            next = data.next_after;
            more = data.has_more;
          } while (more);
          after = next;
          if (active) setHistory(previous => [...(previous || []), ...added].filter(sample => Date.parse(sample.measured_at) >= Date.now() - 30 * 86400_000).sort((a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at)));
        }
        if (active) setHistoryError(undefined);
      } catch {
        if (active) setHistoryError("正在重试");
      } finally { if (active) setNow(Date.now()); loading = false; }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [group.id]);
  const latest = group.samples.at(-1);
  return <dialog ref={dialog} className="ping-dialog" aria-label={`${group.alias} 客户端代理延迟历史`} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-heading"><h2>{group.alias} · 客户端代理延迟</h2><button className="icon-button" aria-label="关闭客户端延迟详情" onClick={onClose}><X size={18} /></button></div>
    <p className="client-dialog-note">Windows 客户端 URLTest · 近 30 天；读取时选中节点：{latest?.node || "未公开或未知"}。测速发生时是否选中无法确认。</p>
    <p className="client-dialog-note">最近测量：{measuredTime(latest)} · {status(latest)}。切换、失败或缺测处断开。</p>
    <div className="ping-history-tools"><div className="range-selector" role="group" aria-label="延迟历史时间范围">{detailRanges.map(option => <button key={option} aria-pressed={range === option} onClick={() => { setRange(option); setNow(Date.now()); }}>{option.toUpperCase()}</button>)}</div></div>
    {history && historyError && <p className="client-dialog-note">显示上次数据 · 正在重试</p>}
    <Suspense fallback={<div className="chart-empty">正在加载图表…</div>}><Trend title="延迟" unit="ms" rows={clientLatencyRows(clientLatencyInRange(history || [], range, now))} lines={[{ key: "latency", name: "URLTest", color: "#4ECDC4" }]} loading={!history && !historyError} error={history ? undefined : historyError} timeScale showPoints /></Suspense>
  </dialog>;
}
