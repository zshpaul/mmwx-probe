import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const palette = ["#3b82f6", "#10b981", "#f59e0b", "#a78bfa", "#ec4899", "#06b6d4"];
const timeLabel = (time: number) => new Date(time * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
const fullTime = (time: number) => new Date(time * 1000).toLocaleString("zh-CN", { hour12: false });

export default function Trend({ title, unit, rows, lines, loading, error, domain }: {
  title: string;
  unit: string;
  rows: Record<string, number | null>[];
  lines: { key: string; name: string }[];
  loading: boolean;
  error?: string;
  domain?: [number, number];
}) {
  const hasValues = rows.some(row => lines.some(line => row[line.key] !== null && row[line.key] !== undefined));
  return <section className="chart-panel">
    <div className="chart-heading"><h3>{title}</h3><span>{unit}</span></div>
    <div className="legend">{lines.map((line, index) => <span key={line.key}><i style={{ background: palette[index % palette.length] }} />{line.name}</span>)}</div>
    <div className="chart" aria-label={`${title}趋势图`}>
      {error ? <div className="chart-empty" role="status">{error}</div> : loading ? <div className="chart-empty">正在加载历史数据…</div> : !hasValues ? <div className="chart-empty">此时间段暂无采样数据</div> :
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={rows} margin={{ left: -18, right: 12, top: 12, bottom: 0 }} accessibilityLayer>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="time" tickFormatter={timeLabel} tick={{ fontSize: 10, fill: "var(--muted)" }} minTickGap={50} axisLine={false} tickLine={false} />
            <YAxis domain={domain || ["auto", "auto"]} tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
            <Tooltip labelFormatter={value => fullTime(Number(value))} formatter={value => [`${Number(value).toFixed(1)} ${unit}`]} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--text)", fontSize: 12 }} />
            {lines.map((line, index) => <Line key={line.key} dataKey={line.key} name={line.name} stroke={palette[index % palette.length]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />)}
          </LineChart>
        </ResponsiveContainer>}
    </div>
  </section>;
}
