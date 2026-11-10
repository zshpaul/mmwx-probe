import { useEffect, useState } from "react";
import { Activity, ArrowUp, ChevronDown, ChevronUp, LayoutGrid, Monitor, Moon, Search, Server, Sun, Table2 } from "lucide-react";
import { useProbe, applyAppearance, saveColorModePreference, readColorModePreference } from "./use-probe";
import { nextColorMode } from "./theme-preference";
import type { ProbePayload, ProbeServer } from "./types";
import { FleetSummary } from "./FleetSummary";
import { VisitorInfo } from "./VisitorInfo";
import type { VisitorData } from "./visitor-model";
import { EmeraldPingSummary, PingDialog } from "./EmeraldPing";
import { ServerDetails } from "./ServerDetails";
import { ServerList } from "./ServerList";
import { OsIcon, RegionFlag } from "./ServerSymbols";
import { billableTraffic, trafficUsageLabel } from "./traffic-display";
import { bytes, isNumber, locationName, nodeLocation, percent, priceCards, ratio, speed, uptime } from "./emerald-model";
import { loadAverage } from "./telemetry-display";

export const designAttribution = "Emerald React adaptation for MMWX Probe; see /THIRD_PARTY_NOTICES.txt.";
function Usage({ label, value, quantity, title }: { label: string; value?: number; quantity?: string; title?: string }) {
  return <div className="usage" title={title}><div><span>{label}</span><strong>{percent(value)}</strong></div><div className="track"><i className={value !== undefined && value >= 90 ? "danger" : value !== undefined && value >= 60 ? "warning" : ""} style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} /></div>{quantity && <p className="resource-quantity">{quantity}</p>}</div>;
}
export function ServerCard({ server, index, now, tri, onPing }: { server: ProbeServer; index: number; now: number; tri?: ProbePayload["tri_isp"]; onPing: () => void }) {
  const traffic = billableTraffic(server);
  const prices = priceCards(server, now);
  const price = prices.find(card => card.label === "节点价格");
  const remaining = prices.find(card => card.label === "剩余时间");
  return <article className={`server-card ${server.online ? "" : "offline"}`}>
    <div className="server-identity"><span className={`status-dot ${server.online ? "" : "down"}`} /><h2><a className="card-link" href={`#server/${index}`} aria-label={`查看 ${server.name || `节点 ${index + 1}`} 详情`}>{server.name || `节点 ${index + 1}`}</a>{nodeLocation(server) && <span className="node-city" title={nodeLocation(server)}>{nodeLocation(server)}</span>}</h2><span className="server-icons"><OsIcon os={server.os} /><RegionFlag server={server} /></span></div>
    <div className="resource-grid">
      {isNumber(server.cpu_pct) && <Usage label="CPU" value={server.cpu_pct} quantity={loadAverage(server.loadavg)} title={server.loadavg} />}
      {(isNumber(server.mem_used) || isNumber(server.mem_total)) && <Usage label="内存" value={ratio(server.mem_used, server.mem_total)} quantity={`${bytes(server.mem_used)} / ${bytes(server.mem_total)}`} />}
      {(isNumber(server.disk_used) || isNumber(server.disk_total)) && <Usage label="硬盘" value={ratio(server.disk_used, server.disk_total)} quantity={`${bytes(server.disk_used)} / ${bytes(server.disk_total)}`} />}
      {isNumber(traffic) && <Usage label="流量" value={ratio(traffic, server.traffic_limit)} quantity={`${bytes(traffic)}${isNumber(server.traffic_limit) && server.traffic_limit > 0 ? ` / ${bytes(server.traffic_limit)}` : ""}`} title={trafficUsageLabel(server)} />}
    </div>
    <div className="card-facts">
      {!server.online && <div className="offline-overlay"><strong>离线</strong>{server.last_seen && <span>{new Date(server.last_seen).toLocaleString("zh-CN", { hour12: false })}</span>}</div>}
      <div className={server.online ? "" : "stale-facts"}>
        {(isNumber(server.upload_speed) || isNumber(server.download_speed)) && <div className="fact-row"><span>速率</span><i /><span className="speed-pair"><span className="upload"><ChevronUp size={12} />{speed(server.upload_speed)}</span><span className="download"><ChevronDown size={12} />{speed(server.download_speed)}</span></span></div>}
        {isNumber(server.uptime) && <div className="fact-row"><span>在线</span><i /><span>{uptime(server.uptime)}</span></div>}
        {(price || remaining) && <div className="fact-row"><span>费用</span><i /><span title={remaining?.title}>{price && `${price.value}${price.unit ? ` ${price.unit}` : ""}`}{price && remaining && " · "}{remaining && <span className={remaining.tone}>{remaining.value}{remaining.unit && ` ${remaining.unit}`}</span>}</span></div>}
        <EmeraldPingSummary server={server} tri={tri} onOpen={onPing} />
      </div>
    </div>
  </article>;
}
function selectedIndex() {
  const match = location.hash.match(/^#\/?server\/(\d+)$/);
  return match ? Number(match[1]) : undefined;
}
function Background() {
  return <div className="emerald-background" aria-hidden="true"><div className="background-glow"><svg><defs><pattern id="emerald-grid" width="72" height="56" patternUnits="userSpaceOnUse" x="-12" y="4"><path d="M.5 56V.5H72" fill="none" /></pattern></defs><rect width="100%" height="100%" strokeWidth="0" fill="url(#emerald-grid)" /><svg x="-12" y="4">{[[288, 168], [144, 56], [504, 168], [720, 336]].map(([left, top]) => <rect key={left} strokeWidth="0" width="73" height="57" x={left} y={top} />)}</svg></svg></div></div>;
}
export function App() {
  const [visitor, setVisitor] = useState<VisitorData>();
  const { data, error, connection, updatedAt } = useProbe();
  const [selected, setSelected] = useState(selectedIndex);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("grid");
  const [pingNode, setPingNode] = useState<number>();
  const [mode, setMode] = useState(() => readColorModePreference());
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const navigate = () => { setSelected(selectedIndex()); window.scrollTo(0, 0); };
    const scroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("hashchange", navigate);
    window.addEventListener("scroll", scroll, { passive: true });
    const media = matchMedia("(prefers-color-scheme: dark)");
    const followSystem = () => { if (readColorModePreference(data?.appearance?.color_mode) === "system") applyAppearance(data?.appearance); };
    setMode(readColorModePreference(data?.appearance?.color_mode));
    media.addEventListener("change", followSystem);
    return () => { window.removeEventListener("hashchange", navigate); window.removeEventListener("scroll", scroll); media.removeEventListener("change", followSystem); };
  }, [data?.appearance?.color_mode]);
  const servers = data?.servers || [];
  const visible = servers.map((server, index) => ({ server, index })).filter(({ server }) => `${server.name || ""} ${locationName(server)} ${server.os || ""}`.toLowerCase().includes(search.toLowerCase()));
  const modeName = { light: "浅色主题", dark: "深色主题", system: "自动主题" }[mode];
  return <><Background /><div className="shell">
    <header className={`topbar ${scrolled ? "scrolled" : ""}`}><a className="brand" href="#"><Server size={28} /><span>ZSH</span></a><nav aria-label="页面工具"><button className="icon-button theme-button" title={`${modeName} · 点击切换`} aria-label={`${modeName}，切换主题`} onClick={() => { const next = nextColorMode(mode); setMode(next); saveColorModePreference(next); applyAppearance(data?.appearance, next); }}>{mode === "system" ? <Monitor size={18} /> : mode === "light" ? <Sun size={18} /> : <Moon size={18} />}</button></nav></header>
    {import.meta.env.DEV && import.meta.env.VITE_PROBE_MOCK === "1" && new URLSearchParams(location.search).has("debug") && <div className="demo-note">演示环境 · 以下为模拟节点与趋势数据</div>}
    {error && <div className="notice error" role="alert">无法更新探针数据（{error}）。{data ? "当前保留最后一次快照，正在自动重试。" : "正在自动重试，请检查服务连接。"}</div>}
    {!data ? <main className="empty"><Activity size={28} /><h1>{error ? "暂时无法连接" : "正在连接探针…"}</h1></main> : !data.enabled ? <main className="empty"><h1>探针尚未启用</h1><p>请在主控中开启公开探针。</p></main> : selected !== undefined ? servers[selected] ? <ServerDetails key={selected} server={servers[selected]} index={selected} updatedAt={updatedAt} /> : <main className="empty"><h1>节点不存在或已移除</h1><a href="#">返回节点列表</a></main> : <main className="home">
      <h1 className="sr-only">节点监控</h1>
      <FleetSummary servers={servers} visitorCountryCode={visitor?.countryCode} formatBytes={bytes} now={updatedAt ?? Date.now()} />
      <div className="toolbar"><span className="group-tab">全部节点</span><div className="view-tools"><div className="view-switch" role="group" aria-label="显示方式"><button aria-label="卡片视图" title="卡片视图" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid size={14} /></button><button aria-label="列表视图" title="列表视图" aria-pressed={view === "list"} onClick={() => setView("list")}><Table2 size={14} /></button></div><label className={`search ${search ? "has-value" : ""}`}><Search size={14} /><input aria-label="搜索节点" placeholder="搜索节点名称、地区、系统" value={search} onChange={event => setSearch(event.target.value)} /></label></div></div>
      {visible.length ? view === "list" ? <ServerList nodes={visible} tri={data.tri_isp} onPing={setPingNode} /> : <div className="servers grid">{visible.map(({ server, index }) => <ServerCard key={index} server={server} index={index} now={updatedAt ?? Date.now()} tri={data.tri_isp} onPing={() => setPingNode(index)} />)}</div> : <div className="empty"><Server size={28} /><h2>{servers.length ? "没有匹配的节点" : "暂无服务器"}</h2>{servers.length > 0 && <button onClick={() => setSearch("")}>清除搜索</button>}</div>}
    </main>}
    <VisitorInfo onVisitor={setVisitor} />
    {pingNode !== undefined && servers[pingNode] && <PingDialog server={servers[pingNode]} index={pingNode} onClose={() => setPingNode(undefined)} />}
    <footer><span>Powered by MMWX Probe</span><span className="connection" title={updatedAt ? `更新于 ${new Date(updatedAt).toLocaleTimeString("zh-CN")}` : undefined}><span className={`status-dot ${error ? "down" : connection === "live" ? "" : "pending"}`} />{error ? "连接异常" : connection === "live" ? "实时连接" : "HTTP 轮询"}</span><a href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">Theme by Emerald</a></footer>
    {scrolled && <button className="back-top icon-button" aria-label="返回顶部" title="返回顶部" onClick={() => window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}><ArrowUp size={16} /></button>}
  </div></>;
}
