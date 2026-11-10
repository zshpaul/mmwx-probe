import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ProbePayload, ProbeServer } from "./types";
import { triISPRows } from "./tri-isp";
import { detailRanges, requestRange, type DetailRange } from "./emerald-model";
import { average, pingHistoryRows, pingSummary, pingTone, smoothPingRows, validLatency, validLoss, type PingResponse } from "./emerald-ping";

const Trend = lazy(() => import("./Trend"));
const colors = ["#FF6B6B", "#4ECDC4", "#A78BFA", "#60A5FA", "#FFB347"];
export function EmeraldPingSummary({ server, tri, onOpen, compact = false }: {
  server: ProbeServer; tri?: ProbePayload["tri_isp"]; onOpen: () => void; compact?: boolean;
}) {
  const rows = triISPRows(tri, server.ping || []);
  const stats = pingSummary(server.ping || []);
  return <div className={`emerald-ping${compact ? " compact" : ""}`}>
    <div className="fact-row"><span>三网</span><i /><span className="carrier-values">{(rows.length ? rows : ["电信", "联通", "移动"].map(label => ({ label, series: undefined }))).slice(0, 3).map((row, index) => {
      const value = row.series && server.online && validLatency(row.series.current_ms) && validLoss(row.series.loss_pct) && row.series.loss_pct < 100 ? row.series.current_ms : undefined;
      return <span key={index} title={`${row.label}${row.series?.label && row.series.label !== row.label ? ` · ${row.series.label}` : ""}：${value === undefined ? "无响应或未上报" : `${Math.round(value)} ms`}`} className={`ping-text ${pingTone(value, "latency")}`}>{index > 0 && <b> · </b>}{value === undefined ? "—" : `${Math.round(value)}ms`}</span>;
    })}</span></div>
    {!compact && <div className="ping-panels">{(["latency", "loss"] as const).map(metric => {
      const label = metric === "latency" ? "延迟" : "丢包";
      const value = stats[metric];
      return <button key={metric} type="button" className="ping-panel" aria-label={`${server.name || "节点"} ${label}`} title={`平均${label}；按已上报目标及采样计算，点击查看历史`} onClick={event => { event.preventDefault(); event.stopPropagation(); onOpen(); }}>
        <span className="fact-row"><span>{label}</span><i /><span>{value === undefined ? "—" : metric === "latency" ? `${Math.round(value)} ms` : `${value.toFixed(1)}%`}</span></span>
        <span className="ping-samples" role="img" aria-label={`${label}采样条：左旧右新，颜色表示分段均值`}>
          {stats.bars.map((bar, index) => <span key={index} className={`ping-sample ${pingTone(bar[metric], metric)}`} title={`${bar.end ? `采样 ${bar.start + 1}–${bar.end}` : "无采样"}：${bar[metric] === undefined ? "无数据" : metric === "latency" ? `${Math.round(bar[metric]!)} ms` : `${bar[metric]!.toFixed(1)}%`}`} />)}
        </span>
      </button>;
    })}</div>}
  </div>;
}
export function PingHistory({ server, index }: { server: ProbeServer; index: number }) {
  const [range, setRange] = useState<DetailRange>("1h");
  const [response, setResponse] = useState<PingResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState<string[]>([]);
  const [delay, setDelay] = useState(true);
  const [loss, setLoss] = useState(true);
  const [smooth, setSmooth] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    setResponse(undefined);
    setLoading(true);
    setError(undefined);
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await fetch(`/api/series?server=${index}&range=${requestRange(range)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), cache: "no-store" });
        if (!result.ok) throw new Error();
        const body = await result.json() as PingResponse;
        if (body.success === false || !Array.isArray(body.all_series) || body.all_series.some(series => !Array.isArray(series.buckets) || series.buckets.some(point => !point || typeof point.ms !== "number" || typeof point.loss !== "number"))) throw new Error();
        if (!controller.signal.aborted) { setResponse(body); setError(undefined); }
      } catch {
        if (!controller.signal.aborted) setError("延迟历史加载失败，稍后自动重试");
      } finally { pending = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [index, range]);
  const series = response?.all_series || [];
  const rows = useMemo(() => pingHistoryRows(response, Number.parseInt(range)), [response, range]);
  const lines = series.flatMap((item, position) => hidden.includes(item.key || item.label) ? [] : [{ key: `latency${position}`, name: item.label, color: colors[position % colors.length] }]);
  const displayed = useMemo(() => smooth ? smoothPingRows(rows, series.map((_, position) => `latency${position}`)) : rows, [rows, smooth, series]);
  const markers = loss ? series.flatMap((item, position) => hidden.includes(item.key || item.label) ? [] : rows.filter(row => row[`loss${position}`] !== null && row[`loss${position}`]! > 0).map(row => ({ time: row.time!, color: colors[position % colors.length] }))) : [];
  const lossKeys = Object.fromEntries(series.map((_, position) => [`latency${position}`, `loss${position}`]));
  return <section className="ping-history" aria-label={`${server.name || "节点"}延迟历史`}>
    <div className="ping-history-tools"><div className="range-selector" role="group" aria-label="延迟历史时间范围">{detailRanges.map(option => <button key={option} aria-pressed={range === option} onClick={() => setRange(option)}>{option.toUpperCase()}</button>)}</div><div className="ping-actions"><button onClick={() => setHidden([])}>全选</button><button onClick={() => setHidden(series.map(item => item.key || item.label))}>全不选</button></div></div>
    {error && <p className="notice error" role="status">{error}</p>}
    <div className="ping-targets">{series.map((item, position) => {
      const key = item.key || item.label;
      const latency = average(rows.map(row => row[`latency${position}`]));
      const packetLoss = average(rows.map(row => row[`loss${position}`]));
      return <button key={key} aria-pressed={!hidden.includes(key)} onClick={() => setHidden(hidden.includes(key) ? hidden.filter(value => value !== key) : [...hidden, key])} title={`最新：${server.online && validLatency(item.current_ms) && validLoss(item.loss_pct) && item.loss_pct < 100 ? `${Math.round(item.current_ms)} ms` : "无响应或未上报"}；均值按当前范围有效采样计算`}><strong><i style={{ background: colors[position % colors.length] }} />{item.label}</strong><span>{latency === undefined ? "—" : `${Math.round(latency)}ms`} · {packetLoss === undefined ? "—" : `${packetLoss.toFixed(2)}%`}</span></button>;
    })}</div>
    <div className="ping-actions"><button aria-pressed={delay} onClick={() => setDelay(!delay)}>延迟</button><button aria-pressed={loss} onClick={() => setLoss(!loss)}>丢包</button><button aria-pressed={smooth} onClick={() => setSmooth(!smooth)} title="EWMA α=0.3；保留缺测断点，关闭可查看原始采样">平滑峰值</button></div>
    <Suspense fallback={<div className="chart-empty">正在加载图表…</div>}>
      <Trend title="延迟" unit="ms" rows={displayed} lines={lines} loading={loading} error={error} showLines={delay} lossMarkers={markers} lossKeys={lossKeys} hideHeading />
    </Suspense>
  </section>;
}
export function PingDialog({ server, index, onClose }: { server: ProbeServer; index: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="ping-dialog" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-label={`${server.name || "节点"}延迟详情`}>
    <div className="dialog-heading"><h2>{server.name || "节点"}</h2><button className="icon-button" aria-label="关闭延迟详情" onClick={onClose}><X size={18} /></button></div>
    <PingHistory server={server} index={index} />
  </dialog>;
}
