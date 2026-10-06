import type { TriISPPublic } from "./types";

/** 一条三网展示行:配置里的槽位 + 它在本机的实测序列(没探到就是 undefined)。 */
export type TriISPRow<S> = {
  isp: string;
  label: string;
  series?: S;
};

type ISPKind = "telecom" | "unicom" | "mobile";

const inferredISPs: Array<{ kind: ISPKind; label: string }> = [
  { kind: "telecom", label: "电信" },
  { kind: "unicom", label: "联通" },
  { kind: "mobile", label: "移动" },
];

function normalizeISP(value?: string): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_.:/\\-]+/g, "");
}

function inferISPKind(value?: string): ISPKind | undefined {
  const normalized = normalizeISP(value);
  if (!normalized) return undefined;

  if (
    normalized === "ct" ||
    normalized === "ctcc" ||
    normalized.includes("电信") ||
    normalized.includes("telecom") ||
    normalized.includes("chinatelecom")
  )
    return "telecom";

  if (
    normalized === "cu" ||
    normalized === "cucc" ||
    normalized.includes("联通") ||
    normalized.includes("unicom") ||
    normalized.includes("chinaunicom")
  )
    return "unicom";

  if (
    normalized === "cm" ||
    normalized === "cmcc" ||
    normalized.includes("移动") ||
    normalized.includes("mobile") ||
    normalized.includes("chinamobile")
  )
    return "mobile";

  return undefined;
}

/**
 * 主控旧版或公开 API 没有下发 tri_isp 时，优先从 ping[].isp 自动识别三网。
 *
 * 只认明确的 ISP 字段，不拿普通 label / key 猜运营商，避免把任意前三个 Ping
 * 目标错误标成电信、联通、移动。只要识别到任意一个运营商，就固定产出三行；
 * 缺失的运营商保留空行，由 UI 显示「—」。
 */
function inferRowsFromSeries<
  S extends { key?: string; label?: string; isp?: string; tri_fallback?: number },
>(series: S[]): TriISPRow<S>[] {
  const matched = new Map<ISPKind, S>();
  for (const item of series) {
    const kind = inferISPKind(item.isp);
    if (kind && !matched.has(kind)) matched.set(kind, item);
  }
  if (matched.size === 0) return [];
  return inferredISPs.map(({ kind, label }) => ({
    isp: kind,
    label,
    series: matched.get(kind),
  }));
}

/**
 * triISPRows 把「三网配置」与「某台服务器的实测序列」对起来,产出三行展示数据。
 *
 * 优先按主控下发的 tri_isp key 精确匹配。主控没有下发 tri_isp 时，使用
 * ping[].isp 自动识别电信 / 联通 / 移动，兼容当前公开探针 API。
 *
 * 匹配不到的槽位仍然保留(series 为空),由调用方画成「无数据」——
 * 直接跳过会让三行变两行,而「移动没数据」本身就是要给人看的信息。
 *
 * 与主控 miaomiaowuX 的三网展示语义保持一致：有明确配置就以配置为准；
 * 没有明确配置时只根据 ISP 元数据识别，不根据普通 Ping 名称猜测。
 */
export function triISPRows<
  S extends { key?: string; label?: string; isp?: string; tri_fallback?: number },
>(tri: TriISPPublic | undefined, series: S[]): TriISPRow<S>[] {
  if (!tri?.enabled || !tri.targets?.length) return inferRowsFromSeries(series);

  const byKey = new Map<string, S>();
  for (const s of series) {
    if (s.key) byKey.set(s.key, s);
  }
  const rows = tri.targets.map((t) => ({
    isp: t.isp,
    label: t.label,
    series: byKey.get(t.key),
  }));

  if (rows.some((row) => row.series)) return rows;

  // tri_isp 存在但 key 已过期或目标变更时，先尝试当前 ping[].isp。
  const inferred = inferRowsFromSeries(series);
  if (inferred.length > 0) return inferred;

  // 最后的兼容兜底：仅使用主控明确标记过 tri_fallback 的目标。
  const marked = series
    .filter((s) => s.key && (s.tri_fallback ?? 0) > 0)
    .sort((a, b) => (a.tri_fallback ?? 0) - (b.tri_fallback ?? 0));

  if (marked.length === 0) return rows;

  return marked.slice(0, 3).map((s, index) => ({
    isp: s.key || `fallback-${index}`,
    label: s.label || s.key || "",
    series: s,
  }));
}
