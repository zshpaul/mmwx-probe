import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { ProbePayload, ProbeServer } from "./types";
import { triISPRows } from "./tri-isp";
import { detailRanges, type DetailRange } from "./emerald-model";
import { average, pingHistoryRows, pingSampleTooltip, pingSummary, pingTone, smoothPingRows, validLatency, validLoss } from "./emerald-ping";
import { latestReturnRoute } from "./telemetry-display";
import { usePingHistory } from "./use-ping-history";

const Trend = lazy(() => import("./Trend"));
const colors = ["#FF6B6B", "#4ECDC4", "#A78BFA", "#60A5FA", "#FFB347"];
type PingBar = { time?: number; latency?: number; loss?: number; tooltip?: string };
export function PingSummaryLayout({ carrier, children, compact = false }: { carrier?: ReactNode; children?: ReactNode; compact?: boolean }) {
  return <div className={`emerald-ping${compact ? " compact" : ""}`}><div className="fact-row"><span>三网</span><i /><span className="carrier-values">{carrier}</span></div>{children}</div>;
}
export function PingPanels({ name, bars, latency, loss, onOpen, loading, error, client = false, latencyText }: {
  name: string; bars: PingBar[]; latency?: number; loss?: number; onOpen: () => void;
  loading?: boolean; error?: string; client?: boolean; latencyText?: string;
}) {
  return <div className="ping-panels">{(["latency", "loss"] as const).map(metric => {
    const label = metric === "latency" ? "延迟" : "丢包";
    const value = metric === "latency" ? latency : loss;
    const unavailable = client && metric === "loss";
    const panel = <><span className="fact-row"><span>{label}</span><i /><span title={unavailable ? "\u672a\u6d4b\u91cf\u4e22\u5305" : undefined}>{unavailable ? "\u2014" : metric === "latency" && latencyText ? latencyText : value === undefined ? "—" : metric === "latency" ? `${Math.round(value)} ms` : `${value.toFixed(1)}%`}</span></span>
      <span className="ping-samples" role={unavailable ? undefined : "img"} aria-label={unavailable ? undefined : client ? "客户端 URLTest 采样条：左旧右新，缺测、切换及失败显示为缺失" : `${label}采样条：左旧右新，颜色表示分段均值`}>
        {!unavailable && bars.map((bar, index) => {
          const tooltip = bar.tooltip || error || (loading ? "加载中" : bar.time === undefined ? "暂无数据" : pingSampleTooltip(bar.time, bar[metric], metric));
          return <span key={index} tabIndex={0} role="img" aria-label={tooltip} data-tooltip={tooltip} className={`ping-sample ${pingTone(bar[metric], metric)}`} />;
        })}
      </span></>;
    return unavailable ? <div key={metric} className="ping-panel">{panel}</div> : <button key={metric} type="button" className="ping-panel" aria-label={client ? `查看 ${name} 客户端 URLTest 延迟历史` : `${name} ${label}`} title={client ? "客户端 URLTest 延迟；读取时选中节点，点击查看历史" : `平均${label}；按已上报目标及采样计算，点击查看历史`} onClick={event => { event.preventDefault(); event.stopPropagation(); onOpen(); }}>{panel}</button>;
  })}</div>;
}
export function PingRouteLabel({ server, isp }: { server: ProbeServer; isp?: string }) {
  const route = latestReturnRoute(server.return_routes, isp);
  const label = route?.route_type?.trim();
  return label && !/^(unknown|未知|[-—]+)$/i.test(label) ? <span className="node-city route-label" title={`回程线路：${label}${route?.tested_at ? `；检测时间：${route.tested_at}` : ""}`}>{label}</span> : null;
}
export function EmeraldPingSummary({ server, index = 0, tri, onOpen, compact = false }: {
  server: ProbeServer; index?: number; tri?: ProbePayload["tri_isp"]; onOpen: () => void; compact?: boolean;
}) {
  const rows = triISPRows(tri, server.ping || []);
  const { data, loading, error } = usePingHistory(index, server, "1h", !compact);
  const stats = pingSummary(data?.all_series || [], data);
  return <PingSummaryLayout compact={compact} carrier={(rows.length ? rows : ["电信", "联通", "移动"].map(label => ({ label, series: undefined }))).slice(0, 3).map((row, index) => {
      const value = row.series && server.online && validLatency(row.series.current_ms) && validLoss(row.series.loss_pct) && row.series.loss_pct < 100 ? row.series.current_ms : undefined;
      return <span key={index} title={`${row.label}${row.series?.label && row.series.label !== row.label ? ` · ${row.series.label}` : ""}：${value === undefined ? "无响应或未上报" : `${Math.round(value)} ms`}`} className={`ping-text ${pingTone(value, "latency")}`}>{index > 0 && <b> · </b>}{value === undefined ? "—" : `${Math.round(value)}ms`}</span>;
    })}>
    {!compact && <PingPanels name={server.name || "节点"} bars={stats.bars} latency={stats.latency} loss={stats.loss} onOpen={onOpen} loading={loading} error={error} />}
  </PingSummaryLayout>;
}
export function PingHistory({ server, index, showRoutes = false }: { server: ProbeServer; index: number; showRoutes?: boolean }) {
  const [range, setRange] = useState<DetailRange>("1h");
  const { data: response, error, loading } = usePingHistory(index, server, range);
  const [hidden, setHidden] = useState<string[]>([]);
  const [delay, setDelay] = useState(true);
  const [loss, setLoss] = useState(true);
  const [smooth, setSmooth] = useState(false);
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
      return <button key={key} aria-pressed={!hidden.includes(key)} onClick={() => setHidden(hidden.includes(key) ? hidden.filter(value => value !== key) : [...hidden, key])} title={`最新：${server.online && validLatency(item.current_ms) && validLoss(item.loss_pct) && item.loss_pct < 100 ? `${Math.round(item.current_ms)} ms` : "无响应或未上报"}；均值按当前范围有效采样计算`}><strong><i style={{ background: colors[position % colors.length] }} /><span className="ping-target-name">{item.label}</span>{showRoutes && <PingRouteLabel server={server} isp={item.isp} />}</strong><span>{latency === undefined ? "—" : `${Math.round(latency)}ms`} · {packetLoss === undefined ? "—" : `${packetLoss.toFixed(2)}%`}</span></button>;
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
