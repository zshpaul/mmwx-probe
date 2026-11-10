import type { ProbePayload, ProbeServer } from "./types";
import { triISPRows } from "./tri-isp";
import { billableTraffic, trafficRuleLabel, trafficUsageLabel } from "./traffic-display";
import { pingState } from "./telemetry-display";

const carriers = [{ isp: "telecom", label: "电信" }, { isp: "unicom", label: "联通" }, { isp: "mobile", label: "移动" }];
const finite = (value?: number) => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function NodeTelemetry({ server, tri, formatBytes }: {
  server: ProbeServer;
  tri: ProbePayload["tri_isp"];
  formatBytes: (value?: number) => string;
}) {
  const matched = triISPRows(tri, server.ping || []);
  const rows = matched.length ? matched : carriers.map(carrier => ({ ...carrier, series: undefined }));
  const used = billableTraffic(server);
  const limit = server.traffic_limit;
  const usage = finite(used) && finite(limit) && limit! > 0 ? used! / limit! * 100 : undefined;
  return <div className="node-telemetry">
    <section className="traffic-summary">
      <div className="telemetry-heading"><h3>流量用量 / 总额度</h3><strong>{usage === undefined ? "—" : `${usage.toFixed(1)}%`}</strong></div>
      <p className="traffic-value">{formatBytes(used)} <span>/ {finite(limit) && limit! > 0 ? formatBytes(limit) : "额度未设置"}</span></p>
      <div className="track" aria-hidden="true"><i style={{ width: `${Math.min(100, usage ?? 0)}%` }} /></div>
      <p className="telemetry-note">{trafficUsageLabel(server)} · {trafficRuleLabel(server)}{usage !== undefined && usage > 100 ? " · 已超额" : ""}</p>
    </section>
    <section className="ping-summary">
      <div className="telemetry-heading"><h3>三网延迟</h3><span>{server.online ? "当前 ms" : "离线 · 历史采样"}</span></div>
      {rows.map((row, rowIndex) => {
        const series = row.series;
        const current = series ? pingState({ ms: series.current_ms, loss: series.loss_pct }) : "missing";
        const buckets = (series?.buckets || []).slice(-24);
        return <div className="ping-row" key={`${row.isp}-${rowIndex}`}>
          <div className="ping-label"><span title={series?.label}>{row.label}</span><strong>{!server.online || current === "missing" ? "—" : current === "lost" ? "超时" : `${series!.current_ms.toFixed(1)} ms`}</strong><small>丢包 {server.online && finite(series?.loss_pct) && series!.loss_pct <= 100 ? `${series!.loss_pct.toFixed(1)}%` : "—"}</small></div>
          <div className="ping-blocks" role="img" aria-label={`${row.label}最近${buckets.length}个采样，左旧右新；悬停查看延迟与丢包`}>
            {Array.from({ length: 24 }, (_, index) => {
              const point = buckets[index - (24 - buckets.length)];
              const state = pingState(point);
              const title = state === "missing" ? "无采样" : state === "lost" ? "超时 · 丢包 100%" : `${point.ms.toFixed(1)} ms · 丢包 ${point.loss.toFixed(1)}%`;
              return <span key={index} className={`ping-block ${state}`} title={title} style={{ height: state === "missing" ? "20%" : state === "lost" ? "100%" : `${Math.max(20, Math.min(100, point.ms / 300 * 100))}%` }} />;
            })}
          </div>
        </div>;
      })}
      <p className="telemetry-note">近 24 个采样 · 左旧右新 · 条高表示延迟（300 ms 封顶）<br />黄绿：响应 · 橙：部分丢包 · 红：超时 · 灰：无采样</p>
    </section>
    <section className="route-summary">
      <div className="telemetry-heading"><h3>三网回程路线</h3><span>最近检测</span></div>
      {carriers.map(carrier => {
        const routes = server.return_routes?.filter(route => route.carrier === carrier.isp) || [];
        return <div className="route-row" key={carrier.isp}><span>{carrier.label}</span><div>{routes.length ? routes.map((route, index) => <span className="route-tag" key={index} title={route.tested_at ? `检测时间：${route.tested_at}` : "检测时间未上报"}>{route.region ? `${route.region} · ` : ""}{route.route_type || "未上报"}</span>) : <span className="telemetry-note">未上报</span>}</div></div>;
      })}
    </section>
  </div>;
}
