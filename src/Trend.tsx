import { useId } from "react";
import { CartesianGrid, Area, AreaChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { bytes, speed } from "./emerald-model";

const resourcePalette = ["var(--blue)", "var(--purple)", "var(--orange)"];
const signalPalette = ["var(--lime)", "var(--green)", "var(--purple)", "var(--orange)", "var(--blue)"];
const timeLabel = (time: number) => new Date(time * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const fullTime = (time: number) => new Date(time * 1000).toLocaleString("zh-CN", { hour12: false });

export default function Trend({ title, summary, unit, rows, lines, loading, error, domain }: {
  title: string;
  summary?: string;
  unit: string;
  rows: Record<string, number | null>[];
  lines: { key: string; name: string; color?: string }[];
  loading: boolean;
  error?: string;
  domain?: [number, number];
}) {
  const identifier = useId().replaceAll(":", "");
  const hasValues = rows.some(row => lines.some(line => row[line.key] !== null && row[line.key] !== undefined));
  const palette = lines.some(line => line.key === "cpu") ? resourcePalette : signalPalette;
  const formatValue = (value: number) => unit === "GB" ? bytes(value * 1024 ** 3) : unit === "MB/s" ? speed(value * 1024 ** 2) : `${Number(value.toFixed(1))}${unit}`;
  return <section className="chart-panel">
    <div className="chart-heading"><h3>{title}</h3><span>{summary || unit}</span></div>
    <div className="chart" aria-label={`${title}趋势图`}>
      {!error && !loading && hasValues && <span className="chart-axis-title">{unit === "%" ? "CPU %" : title === "网络" ? "速度" : title === "连接" ? "连接数" : title}</span>}
      {error ? <div className="chart-empty" role="status">{error}</div> : loading ? <div className="chart-empty">正在加载历史数据…</div> : !hasValues ? <div className="chart-empty">此时间段暂无采样数据</div> :
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={rows} margin={{ left: -4, right: 12, top: 30, bottom: 0 }} accessibilityLayer>
            <defs>{lines.map((line, index) => <linearGradient key={line.key} id={`${identifier}-${line.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={line.color || palette[index % palette.length]} stopOpacity={.25} /><stop offset="1" stopColor={line.color || palette[index % palette.length]} stopOpacity={.02} /></linearGradient>)}</defs>
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" tickFormatter={timeLabel} tick={{ fontSize: 10, fill: "var(--muted)" }} minTickGap={16} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
            <YAxis domain={domain || [0, "auto"]} tickCount={6} tick={({ x, y, payload }) => <text x={x} y={y} dy={3} textAnchor="end" fill="var(--muted)" fontSize={11}>{formatValue(Number(payload.value))}</text>} axisLine={false} tickLine={false} />
            <Tooltip labelFormatter={value => fullTime(Number(value))} formatter={(value, name) => [formatValue(Number(value)), name]} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontSize: 12 }} />
            {lines.length > 1 && <Legend iconSize={10} iconType="square" wrapperStyle={{ fontSize: 10 }} formatter={value => <span style={{ color: "var(--muted)" }}>{value}</span>} />}
            {lines.map((line, index) => <Area key={line.key} type="linear" dataKey={line.key} name={line.name} stroke={line.color || palette[index % palette.length]} fill={`url(#${identifier}-${line.key})`} fillOpacity={lines.length > 1 ? 0 : 1} strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />)}
          </AreaChart>
        </ResponsiveContainer>}
    </div>
  </section>;
}
