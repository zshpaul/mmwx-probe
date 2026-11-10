import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Activity, ArrowDown, ArrowLeft, ArrowUp, ChevronRight, LayoutGrid, List, Search, Server, Sun, Moon } from "lucide-react";
import { PasskeyLogin } from "./PasskeyLogin";
import { useProbe, applyAppearance, saveColorModePreference, readColorModePreference } from "./use-probe";
import type { ProbePayload, ProbePingSeries, ProbeServer } from "./types";
import { effectiveProbeRange, probeRangeOptions, probeRangeBucketSec, probeRangeBucketCount } from "./probe-ranges";
import { resourceHistoryFromSeries, type ResourceSeriesInput } from "./resource-history";
import type { ProbeMetricPoint } from "./conn-sparkline";
import { NodeTelemetry } from "./NodeTelemetry";
import { cpuCoreUsage } from "./telemetry-display";

export const designAttribution = "Adapted for MMWX Probe from Nezha user-frontend-backup / nezha-dash by hamster1963 and contributors (Apache-2.0); layout, styling and data integration modified. See /THIRD_PARTY_NOTICES.txt.";
const Trend = lazy(() => import("./Trend"));
const number = (value?: number) => typeof value === "number" && Number.isFinite(value);
const ratio = (used?: number, total?: number) => number(used) && number(total) && total! > 0 ? Math.min(100, Math.max(0, used! / total! * 100)) : undefined;
function bytes(value?: number, base = 1024) {
  if (!number(value)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Math.max(0, value!), unit = 0;
  while (amount >= base && unit < units.length - 1) { amount /= base; unit++; }
  return `${amount.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
const speed = (value?: number) => number(value) ? `${bytes(value, 1000)}/s` : "—";
const percent = (value?: number) => number(value) ? `${value!.toFixed(1)}%` : "—";
const locationName = (server: ProbeServer) => [server.region_name || server.region || server.region_country, server.region_city].filter(Boolean).join(" · ") || "地区未设置";

function Usage({ label, value, quantity }: { label: string; value?: number; quantity?: string }) {
  return <div className="usage"><div><span>{label}</span><strong>{percent(value)}</strong></div>{quantity && <p className="resource-quantity">{quantity}</p>}<div className="track"><i className={value !== undefined && value > 90 ? "danger" : value !== undefined && value > 70 ? "warning" : ""} style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></div></div>;
}

function ServerCard({ server, index, tri }: { server: ProbeServer; index: number; tri: ProbePayload["tri_isp"] }) {
  const online = server.online;
  return <a className={`server-card ${online ? "" : "offline"}`} href={`#server/${index}`} aria-label={`查看 ${server.name || `节点 ${index + 1}`} 详情`}>
    <div className="server-identity"><span className={`status-dot ${online ? "" : "down"}`} /><div className="identity-copy"><h2>{server.name || `节点 ${index + 1}`}</h2><p>{locationName(server)}</p></div><ChevronRight size={16} className="chevron" /></div>
    <div className="spec"><span>{server.os || "系统未上报"}</span><span>{server.cpu_cores ? `${server.cpu_cores} 核` : "—"} · {bytes(server.mem_total)}</span></div>
    <div className="resource-grid"><Usage label="CPU" value={online ? server.cpu_pct : undefined} quantity={cpuCoreUsage(online ? server.cpu_pct : undefined, server.cpu_cores)} /><Usage label="内存" value={online ? ratio(server.mem_used, server.mem_total) : undefined} quantity={`${bytes(online ? server.mem_used : undefined)} / ${bytes(server.mem_total)}`} /><Usage label="硬盘" value={online ? ratio(server.disk_used, server.disk_total) : undefined} quantity={`${bytes(online ? server.disk_used : undefined)} / ${bytes(server.disk_total)}`} /></div>
    <div className="network-grid"><div><span><ArrowUp size={13} />上传</span><strong>{online ? speed(server.upload_speed) : "—"}</strong></div><div><span><ArrowDown size={13} />下载</span><strong>{online ? speed(server.download_speed) : "—"}</strong></div></div>
    <NodeTelemetry server={server} tri={tri} formatBytes={bytes} />
    <div className="card-bottom"><span className={online ? "online-text" : "offline-text"}>{online ? "在线" : "离线"}<span className="uptime">{online && number(server.uptime) ? ` · 已运行 ${Math.floor(server.uptime! / 86400)} 天` : ""}</span></span></div>
  </a>;
}

type SystemResponse = {
  success?: boolean; generated_at?: number; bucket_sec?: number; buckets?: number;
  series?: ResourceSeriesInput & Record<string, ProbeMetricPoint[] | undefined>;
};
type PingResponse = { success?: boolean; generated_at?: number; bucket_sec?: number; series?: ProbePingSeries; all_series?: ProbePingSeries[] };
type ChartRow = Record<string, number | null>;

function Details({ server, index, data }: { server: ProbeServer; index: number; data: ProbePayload }) {
  const [pickedRange, setRange] = useState("1h");
  const options = probeRangeOptions(data.history_days);
  const range = effectiveProbeRange(pickedRange, options);
  const [history, setHistory] = useState<{ system?: SystemResponse; ping?: PingResponse; systemError?: string; pingError?: string }>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let active = false;
    const load = async (initial = false) => {
      if (active) return;
      active = true;
      if (initial) { setLoading(true); setHistory({}); }
      const request = async <Result,>(suffix: string): Promise<Result> => {
        const response = await fetch(`/api/series?server=${index}&range=${range}${suffix}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as { success?: boolean };
        if (body.success === false) throw new Error("暂时无法获取历史数据");
        return body as Result;
      };
      const [system, ping] = await Promise.allSettled([request<SystemResponse>("&metric=system"), request<PingResponse>("&all=1")]);
      if (!controller.signal.aborted) {
        setHistory({
          system: system.status === "fulfilled" ? system.value : undefined,
          ping: ping.status === "fulfilled" ? ping.value : undefined,
          systemError: system.status === "rejected" ? "系统历史加载失败，稍后自动重试" : undefined,
          pingError: ping.status === "rejected" ? "网络历史加载失败，稍后自动重试" : undefined,
        });
        setLoading(false);
      }
      active = false;
    };
    void load(true);
    const timer = window.setInterval(() => void load(), 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [index, range]);
  const resource = useMemo(() => {
    const system = history.system;
    return resourceHistoryFromSeries(system?.series, system?.generated_at ?? Math.floor(Date.now() / 1000), system?.bucket_sec || probeRangeBucketSec(range), system?.buckets || probeRangeBucketCount(range));
  }, [history.system, range]);
  const resourceRows: ChartRow[] = resource.times.map((time, index) => ({ time, cpu: resource.cpu[index], mem: resource.mem[index], disk: resource.disk[index] }));
  const networkRows = resource.times.map(time => {
    const row: ChartRow = { time };
    for (const key of ["upload_speed", "download_speed"]) {
      const value = history.system?.series?.[key]?.find(point => point.t === time)?.value;
      row[key] = number(value) ? value! / 1000000 : null;
    }
    return row;
  });
  const pings = history.ping?.all_series?.length ? history.ping.all_series : history.ping?.series ? [history.ping.series] : [];
  const pingLength = Math.max(0, ...pings.map(line => line.buckets?.length || 0));
  const bucket = history.ping?.bucket_sec || probeRangeBucketSec(range);
  const end = Math.floor((history.ping?.generated_at ?? Date.now() / 1000) / bucket) * bucket;
  const pingRows = Array.from({ length: pingLength }, (_, index) => {
    const row: ChartRow = { time: end - (pingLength - 1 - index) * bucket };
    pings.forEach((line, lineIndex) => {
      const point = line.buckets?.[index - (pingLength - line.buckets.length)];
      row[`ms${lineIndex}`] = point && number(point.ms) && point.ms >= 0 && point.loss < 100 ? point.ms : null;
      row[`loss${lineIndex}`] = point && number(point.loss) && point.loss >= 0 ? point.loss : null;
    });
    return row;
  });
  return <main>
    <a className="back-link" href="#"><ArrowLeft size={16} />返回节点列表</a>
    <section className="detail-header"><div><div className="eyebrow">节点详情</div><h1><span className={`status-dot ${server.online ? "" : "down"}`} />{server.name || `节点 ${index + 1}`}</h1><p>{locationName(server)} · {server.os || "系统未上报"} · {server.arch || "架构未上报"}</p></div><span className={`badge ${server.online ? "online-text" : "offline-text"}`}>{server.online ? "运行中" : "已离线"}</span></section>
    {!server.online && <div className="notice">节点离线，当前指标为最后上报值。最后心跳：{server.last_seen ? new Date(server.last_seen).toLocaleString("zh-CN") : "未提供"}</div>}
    <section className="detail-metrics"><div><Usage label="CPU 使用率" value={server.cpu_pct} quantity={cpuCoreUsage(server.cpu_pct, server.cpu_cores)} /><p>{server.cpu_model || "型号未上报"}</p></div><div><Usage label="内存使用率" value={ratio(server.mem_used, server.mem_total)} quantity={`${bytes(server.mem_used)} / ${bytes(server.mem_total)}`} /></div><div><Usage label="硬盘使用率" value={ratio(server.disk_used, server.disk_total)} quantity={`${bytes(server.disk_used)} / ${bytes(server.disk_total)}`} /></div></section>
    <section className="detail-facts"><div><span>实时上传</span><strong>{speed(server.upload_speed)}</strong></div><div><span>实时下载</span><strong>{speed(server.download_speed)}</strong></div><div><span>已用 / 配额</span><strong>{bytes(server.traffic_used)} / {bytes(server.traffic_limit)}</strong></div><div><span>TCP / UDP 连接</span><strong>{server.tcp_connections ?? "—"} / {server.udp_connections ?? "—"}</strong></div></section>
    <NodeTelemetry server={server} tri={data.tri_isp} formatBytes={bytes} />
    <div className="section-heading"><div><h2>历史趋势</h2><p>按采样时间展示 · 每 30 秒刷新</p></div><select aria-label="历史时间范围" value={range} onChange={event => setRange(event.target.value)}>{options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></div>
    <Suspense fallback={<div className="empty">正在加载图表…</div>}><div className="charts">
      <Trend title="系统资源" unit="%" rows={resourceRows} lines={[{ key: "cpu", name: "CPU" }, { key: "mem", name: "内存" }, { key: "disk", name: "硬盘" }]} loading={loading} error={history.systemError} domain={[0, 100]} />
      <Trend title="网络速率" unit="MB/s" rows={networkRows} lines={[{ key: "upload_speed", name: "上传" }, { key: "download_speed", name: "下载" }]} loading={loading} error={history.systemError} />
      <Trend title="网络延迟" unit="ms" rows={pingRows} lines={pings.map((line, index) => ({ key: `ms${index}`, name: line.label }))} loading={loading} error={history.pingError} />
      <Trend title="丢包率" unit="%" rows={pingRows} lines={pings.map((line, index) => ({ key: `loss${index}`, name: line.label }))} loading={loading} error={history.pingError} domain={[0, 100]} />
    </div></Suspense>
  </main>;
}

function selectedIndex() {
  const match = location.hash.match(/^#server\/(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

export function App() {
  const { data, error, connection, updatedAt } = useProbe();
  const [selected, setSelected] = useState(selectedIndex);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [region, setRegion] = useState("all");
  const [view, setView] = useState("grid");
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const navigate = () => { setSelected(selectedIndex()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", navigate);
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const media = matchMedia("(prefers-color-scheme: dark)");
    const followSystem = () => { if (readColorModePreference(data?.appearance?.color_mode) === "system") applyAppearance(data?.appearance); };
    media.addEventListener("change", followSystem);
    return () => { window.removeEventListener("hashchange", navigate); observer.disconnect(); media.removeEventListener("change", followSystem); };
  }, [data?.appearance]);
  const servers = data?.servers || [];
  const regions = [...new Set(servers.map(locationName))].sort();
  const visible = servers.map((server, index) => ({ server, index })).filter(({ server }) =>
    `${server.name || ""} ${locationName(server)} ${server.os || ""}`.toLowerCase().includes(search.toLowerCase()) &&
    (status === "all" || server.online === (status === "online")) && (region === "all" || locationName(server) === region));
  return <div className="shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-icon"><Server size={19} /></span><span>MMWX Probe<small>妙妙屋 X · 服务器探针</small></span></a><nav aria-label="页面工具"><span className="connection"><span className={`status-dot ${error ? "down" : connection === "live" ? "" : "pending"}`} />{error ? "连接异常" : connection === "live" ? "实时连接" : "HTTP 轮询"}</span><button className="icon-button" aria-label={dark ? "切换浅色模式" : "切换深色模式"} onClick={() => { saveColorModePreference(dark ? "light" : "dark"); applyAppearance(data?.appearance); }}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button><PasskeyLogin /></nav></header>
    {import.meta.env.DEV && import.meta.env.VITE_PROBE_MOCK === "1" && <div className="demo-note">演示环境 · 以下为模拟节点与趋势数据</div>}
    {error && <div className="notice error" role="alert">无法更新探针数据（{error}）。{data ? "当前保留最后一次快照，正在自动重试。" : "正在自动重试，请检查服务连接。"}</div>}
    {!data ? <main className="empty"><Activity size={28} /><h1>{error ? "暂时无法连接" : "正在连接探针…"}</h1><p>正在获取节点状态</p></main> : !data.enabled ? <main className="empty"><h1>探针尚未启用</h1><p>请在主控中开启公开探针。</p></main> : selected !== undefined ? servers[selected] ? <Details key={selected} server={servers[selected]} index={selected} data={data} /> : <main className="empty"><h1>节点不存在或已移除</h1><a href="#">返回节点列表</a></main> : <main>
      <div className="section-heading home-heading"><div><div className="eyebrow">基础设施 / 节点</div><h1>服务器</h1><p>每一个节点，尽在掌握。</p></div><div className="view-switch" role="group" aria-label="显示方式"><button aria-label="卡片视图" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid size={17} /></button><button aria-label="列表视图" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={18} /></button></div></div>
      <div className="toolbar"><div className="tabs" role="group" aria-label="状态筛选">{[["all", "全部"], ["online", "在线"], ["offline", "离线"]].map(([key, label]) => <button key={key} aria-pressed={status === key} onClick={() => setStatus(key)}>{label}<span>{servers.filter(server => key === "all" || server.online === (key === "online")).length}</span></button>)}</div><div className="search-controls"><select aria-label="地区筛选" value={region} onChange={event => setRegion(event.target.value)}><option value="all">全部地区</option>{regions.map(item => <option key={item}>{item}</option>)}</select><label className="search"><Search size={15} /><input aria-label="搜索节点" placeholder="搜索名称、地区、系统…" value={search} onChange={event => setSearch(event.target.value)} /></label></div></div>
      {visible.length ? <div className={`servers ${view}`}>{visible.map(({ server, index }) => <ServerCard key={index} server={server} index={index} tri={data.tri_isp} />)}</div> : <div className="empty"><Server size={28} /><h2>{servers.length ? "没有匹配的节点" : "暂无服务器"}</h2><p>{servers.length ? "试试其他名称或筛选条件。" : "请在主控中选择需要展示的服务器。"}</p>{servers.length > 0 && <button onClick={() => { setSearch(""); setStatus("all"); setRegion("all"); }}>清除筛选</button>}</div>}
      <div className="list-end"><span>显示 {visible.length} 个节点</span><span>更新于 {updatedAt ? new Date(updatedAt).toLocaleTimeString("zh-CN", { hour12: false }) : "—"}</span></div>
    </main>}
    <footer><span>MMWX Probe <span className="footer-dot">·</span> Powered by <a href="https://github.com/mmwx-group" target="_blank" rel="noreferrer">MMWX Group</a></span>{data?.license_badge && <span>授权信息：{data.license_badge.display_name || data.license_badge.name || "MMWX"}</span>}<a href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">Design adapted from Nezha / nezha-dash ↗</a></footer>
  </div>;
}
