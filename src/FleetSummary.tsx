import { useId } from "react";
import { geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import atlas from "world-atlas/land-110m.json";
import { ArrowDown, ArrowUp, HardDrive, MemoryStick, Network, Server } from "lucide-react";
import type { ProbeServer } from "./types";
import { billableTraffic } from "./traffic-display";

const world = atlas as unknown as Topology;
const land = feature(world, world.objects.land);
const projection = geoOrthographic().rotate([-105, -20]).scale(142).translate([180, 157]);
const landPath = geoPath(projection)(land) || "";

export function FleetSummary({ servers, formatBytes }: { servers: ProbeServer[]; formatBytes: (value?: number) => string }) {
  const identifier = useId().replaceAll(":", "");
  const online = servers.filter(server => server.online);
  const sum = (values: (number | undefined)[]) => {
    const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
    return present.length ? present.reduce((total, value) => total + value, 0) : undefined;
  };
  const memory = online.filter(server => Number.isFinite(server.mem_used) && Number.isFinite(server.mem_total));
  const disks = online.filter(server => Number.isFinite(server.disk_used) && Number.isFinite(server.disk_total));
  const regions = [...new Set(servers.map(server => server.region_name || server.region_country || server.region).filter(Boolean))];
  const stats = [
    { label: "内存用量", value: formatBytes(sum(memory.map(server => server.mem_used))), note: `/ ${formatBytes(sum(memory.map(server => server.mem_total)))}`, icon: MemoryStick },
    { label: "在线节点", value: String(online.length), note: `/ ${servers.length} 台`, icon: Server },
    { label: "实时上行", value: `${formatBytes(sum(online.map(server => server.upload_speed)))}/s`, note: "", icon: ArrowUp },
    { label: "硬盘用量", value: formatBytes(sum(disks.map(server => server.disk_used))), note: `/ ${formatBytes(sum(disks.map(server => server.disk_total)))}`, icon: HardDrive },
    { label: "计费用量合计", value: formatBytes(sum(servers.map(billableTraffic))), note: "", icon: Network },
    { label: "实时下行", value: `${formatBytes(sum(online.map(server => server.download_speed)))}/s`, note: "", icon: ArrowDown },
  ];
  return <section className="fleet-summary" aria-label="节点统计与地区分布">
    <div className="fleet-stats">{stats.map(({ label, value, note, icon: Icon }) => <div className="fleet-stat" key={label}><span>{label}<Icon size={17} /></span><p><strong>{value}</strong> <small>{note}</small></p></div>)}<p className="summary-note">资源与速率仅统计在线且已上报的节点；流量按各节点自身计费周期合计。</p></div>
    <div className="fleet-globe">
      <div className="fleet-status"><span className="online-text">● {online.length} 在线</span><span className="offline-text">● {servers.length - online.length} 离线</span></div>
      <svg viewBox="0 0 360 320" aria-hidden="true">
        <defs><radialGradient id={`${identifier}-sphere`} cx="35%" cy="30%"><stop stopColor="var(--card)" /><stop offset="1" stopColor="var(--globe-shade)" /></radialGradient><pattern id={`${identifier}-dots`} width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".65" fill="var(--globe-ink)" /></pattern></defs>
        <circle cx="180" cy="157" r="143" fill={`url(#${identifier}-sphere)`} stroke="var(--border)" />
        <path d={landPath} fill={`url(#${identifier}-dots)`} />
      </svg>
      <div className="region-chips">{regions.map(region => <span key={region}>{region}</span>)}</div>
      <p className="summary-note">地区分布 · 地球为示意，不标注精确机房坐标</p>
    </div>
  </section>;
}
