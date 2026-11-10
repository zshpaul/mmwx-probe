import { renderToStaticMarkup } from "react-dom/server";
import { FleetSummary } from "./FleetSummary";

const markup = renderToStaticMarkup(<FleetSummary formatBytes={value => value === undefined ? "—" : String(value)} servers={[
  { online: true, mem_used: 2, mem_total: 8, disk_used: 10, disk_total: 100, traffic_used: 12, upload_speed: 5, region_name: "香港" },
  { online: false, mem_used: 999, mem_total: 999, disk_used: 999, disk_total: 999, upload_speed: 999, traffic_used_total: 20, region_name: "香港" },
  { online: true, mem_used: 33, traffic_used: 0 },
]} />);
function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
check(markup.includes("<strong>2</strong><small> / 8</small>"), "Resource sums must exclude stale and incomplete measurements");
check(markup.includes("<strong>32</strong>"), "Traffic sum must include billable fallback and offline usage");
check(markup.includes("<strong>5</strong><small>B/s "), "Speed totals must exclude offline nodes");
check(markup.includes("<strong>10</strong><small> / 100</small>"), "Disk totals must exclude offline resources");
check(markup.includes("不标注精确机房坐标"), "Geographic illustration must not imply measured coordinates");
check((markup.match(/class="fleet-stat"/g) || []).length === 6, "All six overview cards must render");
check(markup.includes("计费流量") && markup.includes("剩余价值"), "Fallback scope and finance must stay visible");
