import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ProbePayload, ProbeServer } from "./types";
import { EmeraldPingSummary } from "./EmeraldPing";
import { OsIcon, RegionFlag } from "./ServerSymbols";
import { billableTraffic, trafficUsageLabel } from "./traffic-display";
import { bytes, isNumber, nodeLocation, percent, ratio, speed } from "./emerald-model";
import { loadAverageTitle } from "./telemetry-display";

const columns = [
  { key: "status", label: "状态" }, { key: "os", label: "系统" }, { key: "name", label: "节点" },
  { key: "cpu", label: "CPU" }, { key: "mem", label: "内存" }, { key: "disk", label: "硬盘" },
  { key: "traffic", label: "流量" }, { key: "rate", label: "速率" },
] as const;
type SortKey = typeof columns[number]["key"];
export function serverSortValue(server: ProbeServer, key: SortKey): string | number | undefined {
  switch (key) {
    case "status": return Number(server.online);
    case "os": return server.os;
    case "name": return server.name;
    case "cpu": return server.cpu_pct;
    case "mem": return ratio(server.mem_used, server.mem_total);
    case "disk": return ratio(server.disk_used, server.disk_total);
    case "traffic": return ratio(billableTraffic(server), server.traffic_limit);
    case "rate": return isNumber(server.upload_speed) || isNumber(server.download_speed) ? (server.upload_speed ?? 0) + (server.download_speed ?? 0) : undefined;
  }
}
function Metric({ label, value, title }: { label: string; value?: number; title?: string }) {
  return <span className="table-metric" title={title} data-label={label}><span>{percent(value)}</span><span className="track"><i style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></span></span>;
}
export function ServerList({ nodes, tri, onPing }: { nodes: { server: ProbeServer; index: number }[]; tri?: ProbePayload["tri_isp"]; onPing: (index: number) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: number }>();
  const sorted = [...nodes].sort((left, right) => {
    if (!sort) return 0;
    const first = serverSortValue(left.server, sort.key), second = serverSortValue(right.server, sort.key);
    if (first === undefined) return second === undefined ? 0 : 1;
    if (second === undefined) return -1;
    return sort.direction * (typeof first === "number" && typeof second === "number" ? first - second : String(first).localeCompare(String(second), "zh-CN"));
  });
  return <div className="server-table">
    <div className="table-heading">{columns.map(column => <button key={column.key} className={`column-${column.key}`} aria-label={`按${column.label}排序`} aria-pressed={sort?.key === column.key} onClick={() => setSort({ key: column.key, direction: sort?.key === column.key ? -sort.direction : 1 })}>{column.label}{sort?.key === column.key && (sort.direction === 1 ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}</button>)}<span>延迟</span></div>
    {sorted.map(({ server, index }) => <div key={index} className={`server-row ${server.online ? "" : "offline"}`}>
      <span className="column-status" title={server.online ? "在线" : "离线"}><span className={`status-dot ${server.online ? "" : "down"}`} /></span>
      <span className="column-os"><OsIcon os={server.os} /></span>
      <span className="column-name"><RegionFlag server={server} /><strong><a className="card-link" href={`#server/${index}`} aria-label={`查看 ${server.name || `节点 ${index + 1}`} 详情`}>{server.name || `节点 ${index + 1}`}</a></strong>{nodeLocation(server) && <span className="node-city" title={nodeLocation(server)}>{nodeLocation(server)}</span>}{!server.online && <small className="negative">离线</small>}</span>
      <Metric label="CPU" value={server.cpu_pct} title={loadAverageTitle(server.loadavg)} />
      <Metric label="内存" value={ratio(server.mem_used, server.mem_total)} title={`${bytes(server.mem_used)} / ${bytes(server.mem_total)}`} />
      <Metric label="硬盘" value={ratio(server.disk_used, server.disk_total)} title={`${bytes(server.disk_used)} / ${bytes(server.disk_total)}`} />
      <Metric label="流量" value={ratio(billableTraffic(server), server.traffic_limit)} title={`${trafficUsageLabel(server)}：${bytes(billableTraffic(server))}${server.traffic_limit ? ` / ${bytes(server.traffic_limit)}` : ""}`} />
      <span className="table-speed"><span className="upload"><ChevronUp size={12} />{speed(server.upload_speed)}</span><span className="download"><ChevronDown size={12} />{speed(server.download_speed)}</span></span>
      <button className="table-ping" aria-label={`${server.name || "节点"} 三网延迟`} onClick={() => onPing(index)}><EmeraldPingSummary server={server} tri={tri} onOpen={() => onPing(index)} compact /></button>
    </div>)}
  </div>;
}
