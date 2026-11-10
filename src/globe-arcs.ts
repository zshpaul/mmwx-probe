import { geoDistance, geoInterpolate, type GeoProjection } from "d3-geo";

interface ArcPoint {
  x: number;
  y: number;
  visible: boolean;
}

/** COBE 2.0.1 二次 Bézier 的最大径向高度，以球半径为单位。 */
export function arcAltitude(
  from: [number, number],
  to: [number, number],
  height = .4,
): number {
  return Math.max(0, .5 * Math.cos(geoDistance(from, to) / 2) + .5 * (1 + height / .8) - 1);
}

/**
 * COBE 的球半径为 0.8，控制点半径为 0.8 + height；高度不是曲线本身的离地距离。
 * 正射投影线性，因此投影端点和控制点后做 Bézier 与三维采样结果相同。
 * 背面且在球盘内的点不可见，与 COBE fragment 的丢弃规则一致。
 */
export function sampleArc(
  projection: GeoProjection,
  from: [number, number],
  to: [number, number],
  segments = 64,
  height = .4,
): ArcPoint[] {
  if (geoDistance(from, to) < 1e-8) return [];
  const [cx, cy] = projection.translate();
  const radius = projection.scale();
  const center = projection.invert?.([cx, cy]);
  if (!center) return [];
  const midpoint: [number, number] = 2 * Math.cos(geoDistance(from, to) / 2) > .001 ? geoInterpolate(from, to)(.5) : [0, 90];
  const controlRadius = 1 + height / .8;
  const controls = [from, midpoint, to].map((coordinate, index) => {
    const projected = projection(coordinate)!;
    const scale = index === 1 ? controlRadius : 1;
    return {
      x: (projected[0] - cx) * scale,
      y: (projected[1] - cy) * scale,
      depth: Math.cos(geoDistance(coordinate, center)) * scale,
    };
  });
  const points: ArcPoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const weights = [(1 - t) ** 2, 2 * (1 - t) * t, t ** 2];
    const dx = controls.reduce((sum, point, index) => sum + weights[index] * point.x, 0);
    const dy = controls.reduce((sum, point, index) => sum + weights[index] * point.y, 0);
    const depth = controls.reduce((sum, point, index) => sum + weights[index] * point.depth, 0);
    points.push({
      x: cx + dx,
      y: cy + dy,
      visible: depth >= 0 || dx * dx + dy * dy >= radius * radius,
    });
  }
  return points;
}

/** 看得见的连续片段拼成 SVG path,被挡住的地方断开。 */
export function arcPath(points: ArcPoint[]): string {
  let d = "";
  let open = false;
  for (const p of points) {
    if (!p.visible) {
      open = false;
      continue;
    }
    d += `${open ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    open = true;
  }
  return d;
}

/** 弧上 t∈[0,1] 处的位置(相邻采样点间线性插值);那里被地球挡住时返回 null。 */
export function arcPointAt(
  points: ArcPoint[],
  t: number,
): { x: number; y: number } | null {
  if (points.length === 0) return null;
  const f = Math.min(Math.max(t, 0), 1) * (points.length - 1);
  const i = Math.floor(f);
  const a = points[i];
  const b = points[Math.min(i + 1, points.length - 1)];
  if (!a.visible || !b.visible) return null;
  const u = f - i;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

/** 地区不超过这么多时两两相连;再多就改成从中心地区放射出去,免得连成一团。 */
export const MESH_MAX_REGIONS = 8;

/**
 * 放射中心取服务器最多的地区;一样多时取离 viewCenter(地球默认朝向)最近的,
 * 让中心一打开就在画面中间,而不是恰好挂在地球边上。
 */
export function pickArcPairs<
  T extends { count: number; coordinates: [number, number] },
>(locations: T[], viewCenter: [number, number]): Array<[T, T]> {
  if (locations.length < 2) return [];
  if (locations.length <= MESH_MAX_REGIONS) {
    const pairs: Array<[T, T]> = [];
    for (let i = 0; i < locations.length; i++) {
      for (let j = i + 1; j < locations.length; j++) {
        pairs.push([locations[i], locations[j]]);
      }
    }
    return pairs;
  }
  const hub = locations.reduce((best, item) => {
    if (item.count !== best.count) return item.count > best.count ? item : best;
    return geoDistance(item.coordinates, viewCenter) <
      geoDistance(best.coordinates, viewCenter)
      ? item
      : best;
  });
  return locations
    .filter((item) => item !== hub)
    .map((item): [T, T] => [hub, item]);
}
