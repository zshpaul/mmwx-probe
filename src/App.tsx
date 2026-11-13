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
import { ClientLatencyDialog, ClientLatencyList, ClientLatencySummary, useClientLatency, type ClientGroup } from "./ClientLatency";
import { bwhUsGroupId, clientGroupPrice } from "./client-latency-prices";
import { quotaUsage, useClientQuota, type ClientQuota } from "./client-quota";
import { useClientRate, type ClientRate } from "./client-rate";

export const designAttribution = "Emerald React adaptation for MMWX Probe; see /THIRD_PARTY_NOTICES.txt.";
function Usage({ label, value, quantity, title, empty = false }: { label: string; value?: number; quantity?: string; title?: string; empty?: boolean }) {
  return <div className="usage" title={title}><div><span>{label}</span>{!empty && <strong>{percent(value)}</strong>}</div><div className="track">{!empty && <i className={value !== undefined && value >= 90 ? "danger" : value !== undefined && value >= 60 ? "warning" : ""} style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} />}</div>{empty ? <p className="resource-quantity" aria-hidden="true">&nbsp;</p> : quantity && <p className="resource-quantity">{quantity}</p>}</div>;
}
export function ServerCard({ server, group, quota, rate, index, now, tri, onPing }: { server?: ProbeServer; group?: ClientGroup; quota?: ClientQuota; rate?: ClientRate; index: number; now: number; tri?: ProbePayload["tri_isp"]; onPing: () => void }) {
  const traffic = server ? billableTraffic(server) : undefined;
  const localPreview = typeof location !== "undefined" && ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("preview");
  const groupPrice = group ? clientGroupPrice(group.id, localPreview) : undefined;
  const prices = priceCards(server ?? groupPrice ?? {}, now);
  const groupExpiry = groupPrice?.expires_at ? Date.parse(groupPrice.expires_at) : NaN;
  const price = prices.find(card => card.label === "节点价格");
  const remaining = prices.find(card => card.label === "剩余时间");
  const placeholders = group?.id === bwhUsGroupId;
  const clientTraffic = quotaUsage(quota);
  const clientTrafficText = quota ? `${bytes(clientTraffic.used)}${isNumber(clientTraffic.total) && clientTraffic.total > 0 ? ` / ${bytes(clientTraffic.total)}` : ""}` : undefined;
  const clientTrafficTitle = quota ? `订阅缓存流量；剩余 ${clientTraffic.remaining === undefined ? "未知" : bytes(clientTraffic.remaining)}；缓存更新时间：${new Date(quota.updated_at).toLocaleString("zh-CN", { hour12: false })}` : undefined;
  return <article className={`server-card ${server && !server.online ? "offline" : ""}`} aria-label={group ? `${group.alias}，客户端代理延迟` : undefined}>
    <div className="server-identity">{server && <span className={`status-dot ${server.online ? "" : "down"}`} />}<h2>{server ? <a className="card-link" href={`#server/${index}`} aria-label={`查看 ${server.name || `节点 ${index + 1}`} 详情`}>{server.name || `节点 ${index + 1}`}</a> : <span title="客户端代理延迟测速组">{group?.alias}</span>}{(server || groupPrice) && nodeLocation(server ?? groupPrice!) && <span className="node-city" title={nodeLocation(server ?? groupPrice!)}>{nodeLocation(server ?? groupPrice!)}</span>}</h2>{(server || groupPrice) && <span className="server-icons">{server && <OsIcon os={server.os} />}<RegionFlag server={server ?? groupPrice!} /></span>}</div>
    <div className="resource-grid">
      {(group || (server && isNumber(server.cpu_pct))) && <Usage label="CPU" empty={!!group && !placeholders} value={placeholders ? 0 : server?.cpu_pct} quantity={server ? loadAverage(server.loadavg) : undefined} title={placeholders ? "占位值，非实测" : server?.loadavg} />}
      {(group || (server && (isNumber(server.mem_used) || isNumber(server.mem_total)))) && <Usage label="内存" empty={!!group && !placeholders} value={placeholders ? 0 : server && ratio(server.mem_used, server.mem_total)} quantity={placeholders ? "0 B / 0 B" : server && `${bytes(server.mem_used)} / ${bytes(server.mem_total)}`} title={placeholders ? "占位值，非实测" : undefined} />}
      {(group || (server && (isNumber(server.disk_used) || isNumber(server.disk_total)))) && <Usage label="硬盘" empty={!!group && !placeholders} value={placeholders ? 0 : server && ratio(server.disk_used, server.disk_total)} quantity={placeholders ? "0 B / 0 B" : server && `${bytes(server.disk_used)} / ${bytes(server.disk_total)}`} title={placeholders ? "占位值，非实测" : undefined} />}
      {(group || (server && isNumber(traffic))) && <Usage label="流量" empty={!!group && !quota} value={group ? ratio(clientTraffic.used, clientTraffic.total) : server && ratio(traffic, server.traffic_limit)} quantity={group ? clientTrafficText : server && `${bytes(traffic)}${isNumber(server.traffic_limit) && server.traffic_limit > 0 ? ` / ${bytes(server.traffic_limit)}` : ""}`} title={group ? clientTrafficTitle : server && trafficUsageLabel(server)} />}
    </div>
    <div className="card-facts">
      {server && !server.online && <div className="offline-overlay"><strong>离线</strong>{server.last_seen && <span>{new Date(server.last_seen).toLocaleString("zh-CN", { hour12: false })}</span>}</div>}
      <div className={server && !server.online ? "stale-facts" : ""}>
        {(group || (server && (isNumber(server.upload_speed) || isNumber(server.download_speed)))) && <div className="fact-row"><span>速率</span><i />{server || placeholders ? <span className="speed-pair" title={group ? rate ? `BWH-US连接速率；采样时间：${new Date(rate.observed_at).toLocaleString("zh-CN", { hour12: false })}` : "BWH-US连接速率暂不可用" : undefined}><span className="upload"><ChevronUp size={12} />{speed(server ? server.upload_speed : rate?.upload_bps)}</span><span className="download"><ChevronDown size={12} />{speed(server ? server.download_speed : rate?.download_bps)}</span></span> : <span />}</div>}
        {(group || (server && isNumber(server.uptime))) && <div className="fact-row"><span>在线</span><i /><span title={placeholders ? "占位值，非实测" : undefined}>{server ? uptime(server.uptime) : placeholders ? "0" : ""}</span></div>}
        {(group || price || remaining) && <div className="fact-row"><span>费用</span><i /><span title={Number.isFinite(groupExpiry) ? `到期时间（香港时间）：${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Hong_Kong", dateStyle: "medium", timeStyle: "medium", hour12: false }).format(groupExpiry)}` : remaining?.title}>{price && `${price.value}${price.unit ? ` ${price.unit}` : ""}`}{price && remaining && " · "}{remaining && <span className={remaining.tone}>{remaining.value}{remaining.unit && ` ${remaining.unit}`}</span>}</span></div>}
        {server ? <EmeraldPingSummary server={server} index={index} tri={tri} onOpen={onPing} /> : group && <ClientLatencySummary group={group} onOpen={onPing} placeholderLoss={placeholders} />}
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
  const [clientDialog, setClientDialog] = useState<string>();
  const { groups: clientGroups, error: clientError } = useClientLatency();
  const clientQuota = useClientQuota();
  const clientRate = useClientRate();
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
  const visibleClients = clientGroups.filter(group => group.alias.toLowerCase().includes(search.toLowerCase())).sort((a, b) => Number(b.id === bwhUsGroupId) - Number(a.id === bwhUsGroupId));
  const selectedClient = clientGroups.find(group => group.id === clientDialog);
  const modeName = { light: "浅色主题", dark: "深色主题", system: "自动主题" }[mode];
  return <><Background /><div className="shell">
    <header className={`topbar ${scrolled ? "scrolled" : ""}`}><a className="brand" href="#"><Server size={28} /><span>ZSH</span></a><nav aria-label="页面工具"><button className="icon-button theme-button" title={`${modeName} · 点击切换`} aria-label={`${modeName}，切换主题`} onClick={() => { const next = nextColorMode(mode); setMode(next); saveColorModePreference(next); applyAppearance(data?.appearance, next); }}>{mode === "system" ? <Monitor size={18} /> : mode === "light" ? <Sun size={18} /> : <Moon size={18} />}</button></nav></header>
    {data?.local_client_only ? <div className="demo-note">本机客户端代理延迟 · 机器主控未连接；BWH-US 为本机实测，其余测试组为合成数据</div> : ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("preview") && <div className="demo-note">本地测试预览 · 主控为模拟数据；BWH-US 如出现为本机实测，其余测速组为合成测试数据</div>}
    {import.meta.env.DEV && import.meta.env.VITE_PROBE_MOCK === "1" && new URLSearchParams(location.search).has("debug") && <div className="demo-note">演示环境 · 以下为模拟节点与趋势数据</div>}
    {error && <div className="notice error" role="alert">无法更新探针数据（{error}）。{data ? "当前保留最后一次快照，正在自动重试。" : "正在自动重试，请检查服务连接。"}</div>}
    {!data ? <main className="empty"><Activity size={28} /><h1>{error ? "暂时无法连接" : "正在连接探针…"}</h1></main> : !data.enabled ? <main className="empty"><h1>探针尚未启用</h1><p>请在主控中开启公开探针。</p></main> : selected !== undefined ? servers[selected] ? <ServerDetails key={selected} server={servers[selected]} index={selected} updatedAt={updatedAt} /> : <main className="empty"><h1>节点不存在或已移除</h1><a href="#">返回节点列表</a></main> : <main className="home">
      <h1 className="sr-only">节点监控</h1>
      {!data.local_client_only && <FleetSummary servers={servers} visitorCountryCode={visitor?.countryCode} formatBytes={bytes} now={updatedAt ?? Date.now()} />}
      {clientError && <div className="notice error" role="status">{clientError}</div>}
      <div className="toolbar"><span className="group-tab">全部节点</span><div className="view-tools"><div className="view-switch" role="group" aria-label="显示方式"><button aria-label="卡片视图" title="卡片视图" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid size={14} /></button><button aria-label="列表视图" title="列表视图" aria-pressed={view === "list"} onClick={() => setView("list")}><Table2 size={14} /></button></div><label className={`search ${search ? "has-value" : ""}`}><Search size={14} /><input aria-label="搜索节点" placeholder="搜索节点名称、地区、系统" value={search} onChange={event => setSearch(event.target.value)} /></label></div></div>
      {visible.length || visibleClients.length ? view === "list" ? <>{visibleClients.length > 0 && <ClientLatencyList groups={visibleClients} onOpen={setClientDialog} />}{visible.length > 0 && <ServerList nodes={visible} tri={data.tri_isp} onPing={setPingNode} />}</> : <div className="servers grid">{visible.slice(0, 1).map(({ server, index }) => <ServerCard key={`server-${index}`} server={server} index={index} now={updatedAt ?? Date.now()} tri={data.tri_isp} onPing={() => setPingNode(index)} />)}{visibleClients.map(group => <ServerCard key={`client-${group.id}`} group={group} quota={group.id === bwhUsGroupId ? clientQuota : undefined} rate={group.id === bwhUsGroupId ? clientRate : undefined} index={0} now={updatedAt ?? Date.now()} onPing={() => setClientDialog(group.id)} />)}{visible.slice(1).map(({ server, index }) => <ServerCard key={`server-${index}`} server={server} index={index} now={updatedAt ?? Date.now()} tri={data.tri_isp} onPing={() => setPingNode(index)} />)}</div> : <div className="empty"><Server size={28} /><h2>{servers.length || clientGroups.length ? "没有匹配的节点或测速组" : "暂无服务器或测速组"}</h2>{search && <button onClick={() => setSearch("")}>清除搜索</button>}</div>}
    </main>}
    <VisitorInfo onVisitor={setVisitor} />
    {selectedClient && <ClientLatencyDialog group={selectedClient} onClose={() => setClientDialog(undefined)} />}
    {pingNode !== undefined && servers[pingNode] && <PingDialog server={servers[pingNode]} index={pingNode} onClose={() => setPingNode(undefined)} />}
    <footer><span>Powered by MMWX Probe</span><span className="connection" title={updatedAt ? `更新于 ${new Date(updatedAt).toLocaleTimeString("zh-CN")}` : undefined}><span className={`status-dot ${error ? "down" : connection === "live" ? "" : "pending"}`} />{error ? "连接异常" : connection === "live" ? "实时连接" : "HTTP 轮询"}</span><a href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">Theme by Emerald</a></footer>
    {scrolled && <button className="back-top icon-button" aria-label="返回顶部" title="返回顶部" onClick={() => window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}><ArrowUp size={16} /></button>}
  </div></>;
}
