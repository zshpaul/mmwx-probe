import { useId } from "react";
import { CartesianGrid, Area, AreaChart, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { bytes, speed } from "./emerald-model";

const resourcePalette = ["var(--blue)", "var(--purple)", "var(--orange)"];
const signalPalette = ["var(--lime)", "var(--green)", "var(--purple)", "var(--orange)", "var(--blue)"];
const timeLabel = (time: number) => new Date(time * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const fullTime = (time: number) => new Date(time * 1000).toLocaleString("zh-CN", { hour12: false });

export default function Trend({ title, summary, unit, rows, lines, loading, error, domain, lossMarkers = [], showLines = true, lossKeys, hideHeading = false }: {
  title: string;
  summary?: string;
  unit: string;
  rows: Record<string, number | null>[];
  lines: { key: string; name: string; color?: string }[];
  loading: boolean;
  error?: string;
  domain?: [number, number];
  lossMarkers?: { time: number; color: string }[];
  showLines?: boolean;
  lossKeys?: Record<string, string>;
  hideHeading?: boolean;
}) {
  const identifier = useId().replaceAll(":", "");
  const hasValues = lossMarkers.length > 0 || rows.some(row => lines.some(line => row[line.key] !== null && row[line.key] !== undefined));
  const palette = lines.some(line => line.key === "cpu") ? resourcePalette : signalPalette;
  const formatValue = (value: number) => unit === "GB" ? bytes(value * 1024 ** 3) : unit === "MB/s" ? speed(value * 1024 ** 2) : `${Number(value.toFixed(1))}${unit}`;
  return <section className="chart-panel">
    {!hideHeading && <div className="chart-heading"><h3>{title}</h3><span>{summary || unit}</span></div>}
    <div className="chart" aria-label={`${title}趋势图`}>
      {!error && !loading && hasValues && <span className="chart-axis-title">{title === "CPU" ? "CPU %" : title === "网络" ? "速度" : title === "连接" ? "连接数" : title}</span>}
      {error ? <div className="chart-empty" role="status">{error}</div> : loading ? <div className="chart-empty">正在加载历史数据…</div> : !hasValues ? <div className="chart-empty">此时间段暂无采样数据</div> :
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={rows} margin={{ left: -4, right: 12, top: 30, bottom: 0 }} accessibilityLayer>
            <defs>{lines.map((line, index) => <linearGradient key={line.key} id={`${identifier}-${line.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={line.color || palette[index % palette.length]} stopOpacity={.25} /><stop offset="1" stopColor={line.color || palette[index % palette.length]} stopOpacity={.02} /></linearGradient>)}</defs>
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" tickFormatter={timeLabel} tick={{ fontSize: 10, fill: "var(--muted)" }} minTickGap={16} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
            <YAxis domain={domain || [0, "auto"]} tickCount={6} tick={({ x, y, payload }) => <text x={x} y={y} dy={3} textAnchor="end" fill="var(--muted)" fontSize={11}>{formatValue(Number(payload.value))}</text>} axisLine={false} tickLine={false} />
            <Tooltip filterNull={!lossKeys} content={lossKeys ? ({ active, label }) => {
              const row = rows.find(row => row.time === Number(label));
              return active && row ? <div className="ping-chart-tooltip"><strong>{fullTime(Number(label))}</strong>{lines.map(line => <p key={line.key} style={{ color: line.color }}>{line.name}：{row[line.key] === null || row[line.key] === undefined ? "—" : `${row[line.key]!.toFixed(1)} ms`} · 丢包 {row[lossKeys[line.key]] === null || row[lossKeys[line.key]] === undefined ? "—" : `${row[lossKeys[line.key]]!.toFixed(1)}%`}</p>)}</div> : null;
            } : undefined} labelFormatter={value => fullTime(Number(value))} formatter={(value, name, item) => {
              const lossKey = lossKeys?.[String(item.dataKey)];
              const packetLoss = lossKey ? item.payload?.[lossKey] : undefined;
              return [`${formatValue(Number(value))}${typeof packetLoss === "number" ? ` · 丢包 ${packetLoss.toFixed(1)}%` : ""}`, name];
            }} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontSize: 12 }} />
            {lines.length > 1 && <Legend iconSize={10} iconType="square" wrapperStyle={{ fontSize: 10 }} formatter={value => <span style={{ color: "var(--muted)" }}>{value}</span>} />}
            {lossMarkers.map((marker, index) => <ReferenceLine key={`${marker.time}-${index}`} x={marker.time} stroke={marker.color} strokeOpacity={.55} strokeWidth={1} />)}
            {lines.map((line, index) => <Area key={line.key} type="linear" dataKey={line.key} name={line.name} stroke={line.color || palette[index % palette.length]} strokeOpacity={showLines ? 1 : 0} fill={`url(#${identifier}-${line.key})`} fillOpacity={lines.length > 1 || !showLines ? 0 : 1} strokeWidth={1.5} dot={false} activeDot={showLines ? { r: 3 } : false} connectNulls={false} isAnimationActive={false} />)}
          </AreaChart>
        </ResponsiveContainer>}
    </div>
  </section>;
}
