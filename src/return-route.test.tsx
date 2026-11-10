import { renderToStaticMarkup } from "react-dom/server";
import { latestReturnRoute } from "./telemetry-display";
import { PingRouteLabel } from "./EmeraldPing";
import type { ProbeReturnRoute } from "./types";

function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${expected}, received ${actual}`);
}
const routes: ProbeReturnRoute[] = [
  { carrier: "telecom", route_type: "163", tested_at: "2026-11-09T00:00:00Z" },
  { carrier: "unicom", route_type: "9929", tested_at: "2026-11-10T00:00:00Z" },
  { carrier: "telecom", route_type: "CN2 GIA", tested_at: "2026-11-10T06:48:09Z" },
  { carrier: "mobile", route_type: "CMIN2", tested_at: "2026-11-10T00:00:00Z" },
  { carrier: "telecom", route_type: "Unknown", tested_at: "invalid" },
];
equal(latestReturnRoute(routes, "telecom")?.route_type, "CN2 GIA");
equal(latestReturnRoute([...routes].reverse(), "telecom")?.route_type, "CN2 GIA");
equal(latestReturnRoute(routes, "unicom")?.route_type, "9929");
equal(latestReturnRoute(routes, "mobile")?.route_type, "CMIN2");
equal(latestReturnRoute(routes, "电信"), undefined);
equal(latestReturnRoute(routes), undefined);
equal(latestReturnRoute(undefined, "telecom"), undefined);
equal(latestReturnRoute([], "telecom"), undefined);
equal(latestReturnRoute([{ carrier: "mobile", route_type: "CMI" }], "mobile")?.route_type, "CMI");
const render = (isp?: string, return_routes = routes) => renderToStaticMarkup(<PingRouteLabel server={{ online: true, return_routes }} isp={isp} />);
equal(render("telecom").includes("CN2 GIA"), true);
equal(render("telecom").includes("回程线路：CN2 GIA；检测时间：2026-11-10T06:48:09Z"), true);
equal(render(undefined), "");
equal(render("unicom", []), "");
equal(render("telecom", [{ carrier: "telecom", route_type: " " }]), "");
for (const route_type of ["Unknown", "unknown", "未知", "—", "-"]) equal(render("mobile", [{ carrier: "mobile", route_type }]), "");
equal(render("mobile", [{ carrier: "mobile", route_type: "CMI" }]).includes('title="回程线路：CMI"'), true);
