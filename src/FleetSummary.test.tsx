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
const globeServers = [{ online: true, region_country: "HK" }, { online: true, region_country: "JP" }];
const withVisitor = renderToStaticMarkup(<FleetSummary servers={globeServers} formatBytes={String} visitorCountryCode="US" />);
const withoutVisitor = renderToStaticMarkup(<FleetSummary servers={globeServers} formatBytes={String} />);
const invalidVisitor = renderToStaticMarkup(<FleetSummary servers={globeServers} formatBytes={String} visitorCountryCode="XX" />);
check((withVisitor.match(/节点国家至访客国家的示意连线/g) || []).length === 2, "Each node country connects to visitor country");
check(!withoutVisitor.includes("节点国家至访客国家的示意连线") && !invalidVisitor.includes("节点国家至访客国家的示意连线"), "No visitor means no arcs");
check(withVisitor.includes('stroke-width="0.8"'), "Emerald arc width");
const sameCountry = renderToStaticMarkup(<FleetSummary servers={[...globeServers, { online: true, region_country: "US" }]} formatBytes={String} visitorCountryCode="US" />);
check((sameCountry.match(/节点国家至访客国家的示意连线/g) || []).length === 2, "Same-country nodes must not create a degenerate arc");
const onlySameCountry = renderToStaticMarkup(<FleetSummary servers={[{ online: true, region_country: "US" }]} formatBytes={String} visitorCountryCode="US" />);
check(!onlySameCountry.includes("节点国家至访客国家的示意连线"), "Only same-country nodes means no arcs");
