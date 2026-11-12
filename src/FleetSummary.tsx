import { useEffect, useId, useMemo, useRef, useState } from "react";
import { geoCentroid, geoContains, geoDistance, geoOrthographic } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import atlas from "world-atlas/countries-110m.json";
import { numericToAlpha2 } from "i18n-iso-countries";
import { ChevronDown, ChevronUp, Coins, HardDrive, MemoryStick, Network, X } from "lucide-react";
import type { ProbeServer } from "./types";
import { billableTraffic } from "./traffic-display";
import { financeSummary, speed } from "./emerald-model";
import { RegionFlag } from "./ServerSymbols";
import { layoutGlobeLabels } from "./globe-labels";
import { arcPath, sampleArc } from "./globe-arcs";
import { advanceGlobeLongitude, globeRotationStep } from "./globe-motion";
import { frankfurtDisplay } from "./location-display";

const world = atlas as unknown as Topology;
const land = feature(world, world.objects.land);
const countries = feature(world, world.objects.countries);
const coordinates = new Map<string, [number, number]>();
if (countries.type === "FeatureCollection") for (const country of countries.features) {
  const code = numericToAlpha2(String(country.id));
  if (code) coordinates.set(code, geoCentroid(country));
}
coordinates.set("HK", [114.1694, 22.3193]);
coordinates.set("MO", [113.5439, 22.1987]);
coordinates.set("SG", [103.8198, 1.3521]);
const dots: [number, number][] = [];
for (let latitude = -86; latitude <= 86; latitude += 2) {
  const step = 2 / Math.cos(latitude * Math.PI / 180);
  for (let longitude = -180; longitude < 180; longitude += step) {
    if (geoContains(land, [longitude, latitude])) dots.push([longitude, latitude]);
  }
}
const sum = (values: (number | undefined)[]) => {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  return present.length ? present.reduce((total, value) => total + value, 0) : undefined;
};
function Globe({ servers, visitorCountryCode }: { servers: ProbeServer[]; visitorCountryCode?: string }) {
  const identifier = useId().replaceAll(":", "");
  const [rotation, setRotation] = useState<[number, number]>([-105, -20]);
  const dragging = useRef(false);
  const position = useRef<[number, number]>([0, 0]);
  const projection = geoOrthographic().rotate(rotation).scale(174).translate([224, 224]);
  const center: [number, number] = [-rotation[0], -rotation[1]];
  useEffect(() => {
    let frame = 0;
    let previous: number | undefined;
    const animate = (time: number) => {
      const step = globeRotationStep(previous === undefined ? 0 : time - previous, dragging.current, document.visibilityState === "visible");
      previous = time;
      if (step) setRotation(([longitude, latitude]) => [advanceGlobeLongitude(longitude, step), latitude]);
      frame = requestAnimationFrame(animate);
    };
    const sync = () => {
      dragging.current = false;
      cancelAnimationFrame(frame);
      previous = undefined;
      if (document.visibilityState === "visible") frame = requestAnimationFrame(animate);
    };
    const release = () => { dragging.current = false; };
    window.addEventListener("blur", release);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("blur", release);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  const clusters = useMemo(() => {
    const grouped = new Map<string, ProbeServer[]>();
    for (const server of servers) {
      const code = (server.region_country || server.region || "").toUpperCase();
      if (coordinates.has(code)) grouped.set(code, [...(grouped.get(code) || []), server]);
    }
    return [...grouped].map(([code, nodes]) => ({ code, nodes, coordinate: coordinates.get(code)! }));
  }, [servers]);
  const visitorCoordinate = coordinates.get(visitorCountryCode || "");
  const arcs = visitorCoordinate ? clusters.filter(cluster => cluster.code !== visitorCountryCode).map(cluster => ({
    code: cluster.code,
    path: arcPath(sampleArc(projection, cluster.coordinate, visitorCoordinate, 64, .4)),
  })) : [];
  const path = dots.filter(point => geoDistance(center, point) < Math.PI / 2).map(point => {
    const [left, top] = projection(point)!;
    const radius = .75 * Math.max(.25, Math.cos(geoDistance(center, point)));
    return `M${left.toFixed(2)},${top.toFixed(2)}h${radius.toFixed(2)}`;
  }).join("");
  const visible = clusters.filter(cluster => geoDistance(center, cluster.coordinate) < Math.PI / 2).map(cluster => {
    const [left, top] = projection(cluster.coordinate)!;
    return { ...cluster, x: left, y: top, count: cluster.nodes.length };
  });
  const labels = layoutGlobeLabels(visible, { height: 44, flag: 80, digit: 0, padding: 2, gap: 0, offset: 8, dotRadius: 4 }, { cx: 224, cy: 224, r: 176 });
  const online = servers.filter(server => server.online).length;
  return <div className="fleet-globe">
    <svg viewBox="0 0 448 448" role="img" aria-label="节点地区地球；国家级示意，不标注精确机房坐标，可拖动旋转" tabIndex={0}
      onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); setRotation(([longitude, latitude]) => [longitude + (event.key === "ArrowLeft" ? -8 : event.key === "ArrowRight" ? 8 : 0), Math.max(-65, Math.min(65, latitude + (event.key === "ArrowUp" ? 8 : event.key === "ArrowDown" ? -8 : 0)))]); } }}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); dragging.current = true; position.current = [event.clientX, event.clientY]; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (!dragging.current) return; const previous = position.current; position.current = [event.clientX, event.clientY]; setRotation(([longitude, latitude]) => [longitude + (event.clientX - previous[0]) / 2, Math.max(-65, Math.min(65, latitude - (event.clientY - previous[1]) / 3))]); }}
      onPointerUp={event => { dragging.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { dragging.current = false; }} onLostPointerCapture={() => { dragging.current = false; }}>
      <defs><radialGradient id={`${identifier}-sphere`} cx="40%" cy="35%"><stop stopColor="var(--globe-center)" /><stop offset=".83" stopColor="var(--globe-edge)" /><stop offset="1" stopColor="var(--globe-rim)" /></radialGradient><clipPath id={`${identifier}-labels`}><rect width="448" height="250" /></clipPath></defs>
      <circle cx="224" cy="224" r="176" fill={`url(#${identifier}-sphere)`} className="globe-sphere" />
      <path d={path} stroke="var(--globe-ink)" strokeWidth="1.5" strokeLinecap="round" />
      <g className="globe-arcs" fill="none" strokeWidth={1.6} strokeLinecap="round" pointerEvents="none">{arcs.map(arc => <path key={arc.code} d={arc.path}><title>节点国家至访客国家的示意连线</title></path>)}</g>
      <g className="globe-labels" clipPath={`url(#${identifier}-labels)`}>{visible.map(cluster => {
        const onlineNodes = cluster.nodes.filter(server => server.online);
        const label = labels.find(label => label.code === cluster.code);
        return <g key={cluster.code}><title>{`${frankfurtDisplay(cluster.nodes[0].region_name || cluster.code)} · ${cluster.nodes.length} 台；国家级示意位置`}</title><circle cx={cluster.x} cy={cluster.y} r="3" fill={onlineNodes.length ? "#059669" : "#d97706"} />{label && <foreignObject x={label.x} y={label.y} width={label.width} height={label.height}><div className="globe-rate" title="在线节点已上报速率合计"><span className="upload"><ChevronUp size={12} />{speed(sum(onlineNodes.map(server => server.upload_speed)))}</span><span className="download"><ChevronDown size={12} />{speed(sum(onlineNodes.map(server => server.download_speed)))}</span></div><RegionFlag server={cluster.nodes[0]} /></foreignObject>}</g>;
      })}</g>
    </svg>
    <div className="fleet-status" title={`${online} 在线 · ${servers.length - online} 离线`}><span className="positive">● {online}</span><span className="warning">● {servers.length - online}</span></div>
  </div>;
}
export function FleetSummary({ servers, formatBytes, now = Date.now(), visitorCountryCode }: { servers: ProbeServer[]; formatBytes: (value?: number) => string; now?: number; visitorCountryCode?: string }) {
  const financeDialog = useRef<HTMLDialogElement>(null);
  const online = servers.filter(server => server.online);
  const memory = online.filter(server => Number.isFinite(server.mem_used) && Number.isFinite(server.mem_total));
  const disks = online.filter(server => Number.isFinite(server.disk_used) && Number.isFinite(server.disk_total));
  const finance = financeSummary(servers, now);
  const primary = finance.find(group => group.currency === "CNY") || finance[0];
  const split = (value: string) => { const [amount, ...unit] = value.split(" "); return { value: amount, note: unit.join(" ") }; };
  const cumulative = servers.map(server => Number.isFinite(server.cumulative_up) && Number.isFinite(server.cumulative_down) ? server.cumulative_up! + server.cumulative_down! : undefined);
  const hasCumulative = cumulative.some(value => value !== undefined);
  const stats: { label: string; value: string; note: string; suffix?: string; icon: typeof Coins; title: string }[] = [
    { label: "内存用量", ...split(formatBytes(sum(memory.map(server => server.mem_used)))), suffix: `/ ${formatBytes(sum(memory.map(server => server.mem_total)))}`, icon: MemoryStick, title: "仅汇总在线且同时上报用量与总量的节点" },
    { label: "剩余价值", value: primary?.estimated ? `${primary.currency === "CNY" ? "¥" : ""}${primary.remaining.toFixed(2)}` : "—", note: primary?.currency || "", icon: Coins, title: "按价格、计费周期及到期时间估算；点击查看各币种，缺失字段不计入；不换汇" },
    { label: "实时上行", ...split(speed(sum(online.map(server => server.upload_speed)))), icon: ChevronUp, title: "在线节点已上报上行速率合计" },
    { label: "硬盘用量", ...split(formatBytes(sum(disks.map(server => server.disk_used)))), suffix: `/ ${formatBytes(sum(disks.map(server => server.disk_total)))}`, icon: HardDrive, title: "仅汇总在线且同时上报用量与总量的节点" },
    { label: hasCumulative ? "累计流量" : "计费流量", ...split(formatBytes(sum(hasCumulative ? cumulative : servers.map(billableTraffic)))), icon: Network, title: hasCumulative ? "已上报 cumulative_up + cumulative_down；各节点计数器复位时间可能不同" : "各节点自身计费周期用量合计；未上报累计计数，不冒充终身累计流量" },
    { label: "实时下行", ...split(speed(sum(online.map(server => server.download_speed)))), icon: ChevronDown, title: "在线节点已上报下行速率合计" },
  ];
  return <section className="fleet-summary" aria-label="节点统计与地区分布">
    <Globe servers={servers} visitorCountryCode={visitorCountryCode} />
    <div className="fleet-stats">{stats.map(({ label, value, note, suffix, icon: Icon, title }) => {
      const content = <><span>{label}<Icon size={20} /></span><p><strong>{value}</strong><small>{note} {suffix}</small></p></>;
      return label === "剩余价值" ? <button className="fleet-stat" key={label} title={title} onClick={() => financeDialog.current?.showModal()}>{content}</button> : <div className="fleet-stat" key={label} title={title}>{content}</div>;
    })}</div>
    <dialog ref={financeDialog} className="finance-dialog" aria-label="节点价值" onClick={event => { if (event.target === event.currentTarget) financeDialog.current?.close(); }}>
      <div className="dialog-heading"><h2>节点价值</h2><button className="icon-button" aria-label="关闭节点价值" onClick={() => financeDialog.current?.close()}><X size={18} /></button></div>
      {finance.length ? finance.map(group => <div className="finance-group" key={group.currency}><h3>{group.currency}</h3><dl><div><dt>总价值</dt><dd>{group.total.toFixed(2)}</dd></div><div><dt>月均支出</dt><dd>{group.periodic ? group.monthly.toFixed(2) : "—"}</dd></div><div><dt>剩余价值</dt><dd>{group.estimated ? group.remaining.toFixed(2) : "—"}</dd></div></dl><p>{group.priced} 台已上报价格；{group.periodic} 台可折算月均；{group.estimated} 台可估算剩余价值。</p></div>) : <p>尚无完整价格数据</p>}
      <p className="telemetry-note">各币种分别汇总，不换汇。月均按 30 天折算；剩余价值按计费周期和到期时间估算，非账单或可退款金额。</p>
    </dialog>
  </section>;
}
