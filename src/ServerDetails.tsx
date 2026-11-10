import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Banknote, CalendarDays, Coins, Cpu, HardDrive, MemoryStick, Monitor, Network, Receipt, Server, Timer, Workflow, type LucideIcon } from "lucide-react";
import type { ProbeServer } from "./types";
import { OsIcon, RegionFlag } from "./ServerSymbols";
import { PingHistory } from "./EmeraldPing";
import { billableTraffic, trafficUsageLabel } from "./traffic-display";
import { requestJson } from "./request-json";
import { bytes, detailRanges, historyRows, isNumber, nodeLocation, percent, priceCards, ratio, requestRange, speed, uptime, type DetailRange, type SystemResponse } from "./emerald-model";
const Trend = lazy(() => import("./Trend"));
type InfoItem = { label: string; value?: ReactNode; icon: LucideIcon; wide?: boolean; title?: string; progress?: number; aside?: string };
function InfoCard({ title, items, layout }: { title: string; items: InfoItem[]; layout: string }) {
  const visible = items.filter(item => item.value !== undefined && item.value !== null && item.value !== "");
  if (!visible.length) return null;
  return <article className={`info-card ${layout}`}><h2>{title}</h2><dl>{visible.map(({ label, value, icon: Icon, wide, title, progress, aside }) => <div key={label} className={wide ? "wide" : undefined} title={title} style={progress === undefined ? undefined : { backgroundImage: `linear-gradient(to right, color-mix(in oklab, var(--foreground) 10%, transparent) ${progress}%, transparent ${progress}%)` }}><dt><Icon size={14} />{label}{aside && <small>{aside}</small>}</dt><dd>{value}</dd></div>)}</dl></article>;
}
const priceIcons = [Banknote, Receipt, CalendarDays, Coins];

export function ServerDetails({ server, index, updatedAt }: { server: ProbeServer; index: number; updatedAt?: number }) {
  const [range, setRange] = useState<DetailRange>("1h");
  const [history, setHistory] = useState<SystemResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    setHistory(undefined);
    setError(undefined);
    setLoading(true);
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const body = await requestJson<SystemResponse>(`/api/series?server=${index}&range=${requestRange(range)}&metric=system`, {
          signal: controller.signal, cache: "no-store",
        });
        if (!body || body.success === false || !body.series || typeof body.series !== "object" || Object.values(body.series).some(points => points !== undefined && (!Array.isArray(points) || points.some(point => !point || typeof point.t !== "number")))) throw new Error("历史响应格式无效");
        if (!controller.signal.aborted) { setHistory(body); setError(undefined); }
      } catch {
        if (!controller.signal.aborted) setError("系统历史加载失败，稍后自动重试");
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [index, range]);
  const rows = useMemo(() => historyRows(history, range), [history, range]);
  const prices = priceCards(server, updatedAt ?? Date.now());
  const present = (current: unknown, ...keys: string[]) => isNumber(current) || keys.some(key => Array.isArray(history?.series?.[key]) && history.series[key]!.length > 0);
  const traffic = billableTraffic(server);
  const hardware: InfoItem[] = [
    { label: "CPU", value: server.cpu_model ? `${server.cpu_model}${server.cpu_cores ? ` (x${server.cpu_cores})` : ""}` : isNumber(server.cpu_cores) ? `${server.cpu_cores} 核` : undefined, icon: Cpu, wide: true },
    { label: "架构", value: server.arch, icon: Workflow },
    { label: "内核", value: server.kernel, icon: Server },
  ];
  const system: InfoItem[] = [
    { label: "操作系统", value: server.os ? <span className="os-value"><OsIcon os={server.os} />{server.os}</span> : undefined, icon: Monitor },
    { label: "运行时间", value: uptime(server.uptime), icon: Timer },
    { label: "最后上报", value: !server.online && server.last_seen && Number.isFinite(Date.parse(server.last_seen)) ? new Date(server.last_seen).toLocaleString("zh-CN", { hour12: false }) : undefined, icon: Timer },
  ];
  const storage: InfoItem[] = [
    { label: "内存", value: isNumber(server.mem_total) ? bytes(server.mem_total) : undefined, icon: MemoryStick },
    { label: "硬盘", value: isNumber(server.disk_total) ? bytes(server.disk_total) : undefined, icon: HardDrive },
  ];
  const network: InfoItem[] = [
    { label: "总流量", value: isNumber(traffic) ? `${bytes(traffic)}${isNumber(server.traffic_limit) && server.traffic_limit > 0 ? ` / ${bytes(server.traffic_limit)}` : ""}` : undefined, icon: Network, title: trafficUsageLabel(server), progress: ratio(traffic, server.traffic_limit), aside: isNumber(server.traffic_used_up) && isNumber(server.traffic_used_down) ? `${bytes(server.traffic_used_up)} / ${bytes(server.traffic_used_down)}` : undefined },
    { label: "网络速率", value: isNumber(server.upload_speed) || isNumber(server.download_speed) ? `↑ ${speed(server.upload_speed)}　↓ ${speed(server.download_speed)}` : undefined, icon: Network },
  ];
  return <main className="detail">
    <div className="detail-heading"><a href="#" className="icon-button back-link" aria-label="返回节点列表" title="返回节点列表"><ArrowLeft size={16} /></a><h1><RegionFlag server={server} /><span className="node-name">{server.name || `节点 ${index + 1}`}</span>{nodeLocation(server) && <span className="node-city" title={nodeLocation(server)}>{nodeLocation(server)}</span>}</h1><span className={`status-badge ${server.online ? "positive" : "negative"}`}>{server.online ? "在线" : "离线"}</span></div>
    {!server.online && <div className="notice">节点离线，以下为最后上报值。</div>}
    {prices.length > 0 && <section className="price-grid" aria-label="价格信息">{prices.map(card => {
      const Icon = priceIcons[["节点价格", "月均支出", "剩余时间", "剩余价值"].indexOf(card.label)];
      const largeCurrency = card.label === "节点价格" || card.label === "月均支出";
      return <article className="price-card" key={card.label} title={card.title}><div><span>{card.label}</span><Icon size={20} /></div><p className={card.tone}><strong>{card.value}{largeCurrency && card.unit && ` ${card.unit.split(" / ")[0]}`}</strong>{card.unit && <small>{largeCurrency ? card.unit.includes(" / ") ? `/ ${card.unit.split(" / ")[1]}` : "" : card.unit}</small>}</p></article>;
    })}</section>}
    <section className="detail-information"><InfoCard title="硬件信息" items={hardware} layout="hardware" /><InfoCard title="系统信息" items={system} layout="system" /><InfoCard title="存储信息" items={storage} layout="storage" /><InfoCard title="网络信息" items={network} layout="network" /></section>
    <div className="range-selector" role="group" aria-label="历史时间范围">{detailRanges.map(option => <button key={option} aria-pressed={range === option} onClick={() => setRange(option)}>{option.toUpperCase()}</button>)}</div>
    {error && <div role="status" className="notice error">{error}</div>}
    <Suspense fallback={<div className="empty">正在加载图表…</div>}><div className="charts">
      {present(server.cpu_pct, "cpu_pct") && <Trend title="CPU" summary={percent(server.cpu_pct)} unit="%" rows={rows} lines={[{ key: "cpu", name: "CPU", color: "#FF6B6B" }]} loading={loading} error={error} domain={[0, 100]} />}
      {present(server.mem_used, "mem_used") && <Trend title="内存" summary={`${bytes(server.mem_used)} · ${bytes(server.mem_total)}`} unit="GB" rows={rows} lines={[{ key: "mem_used", name: "内存", color: "#FF6B6B" }]} loading={loading} error={error} />}
      {present(server.disk_used, "disk_used") && <Trend title="磁盘" summary={`${bytes(server.disk_used)} · ${bytes(server.disk_total)}`} unit="GB" rows={rows} lines={[{ key: "disk_used", name: "磁盘", color: "#4ECDC4" }]} loading={loading} error={error} />}
      {present(server.upload_speed, "upload_speed") || present(server.download_speed, "download_speed") ? <Trend title="网络" summary={`↑ ${speed(server.upload_speed)}　↓ ${speed(server.download_speed)}`} unit="MB/s" rows={rows} lines={[{ key: "download_speed", name: "下载", color: "#60A5FA" }, { key: "upload_speed", name: "上传", color: "#A78BFA" }]} loading={loading} error={error} /> : null}
      {present(server.tcp_connections, "tcp_connections") || present(server.udp_connections, "udp_connections") ? <Trend title="连接" summary={`TCP: ${server.tcp_connections ?? "—"} · UDP: ${server.udp_connections ?? "—"}`} unit="" rows={rows} lines={[{ key: "tcp_connections", name: "TCP", color: "#FF6B6B" }, { key: "udp_connections", name: "UDP", color: "#4ECDC4" }]} loading={loading} error={error} /> : null}
    </div></Suspense>
    {!!server.ping?.length && <PingHistory server={server} index={index} showRoutes />}
    {!loading && !error && !["cpu_pct", "mem_used", "disk_used", "upload_speed", "download_speed", "tcp_connections", "udp_connections"].some(key => present(server[key as keyof ProbeServer], key)) && <div className="empty">此节点尚未上报系统指标</div>}
  </main>;
}
