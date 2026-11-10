import { renderToStaticMarkup } from "react-dom/server";
import { NodeTelemetry } from "./NodeTelemetry";
import type { ProbeServer } from "./types";

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const server: ProbeServer = {
  online: true,
  traffic_used_total: 150,
  traffic_limit: 100,
  ping: [{
    label: "上海电信", isp: "telecom", current_ms: 42, loss_pct: 0,
    buckets: [{ ms: -1, loss: 100 }, { ms: 39, loss: 2.5 }, { ms: 42, loss: 0 }],
  }],
  return_routes: [{ carrier: "telecom", route_type: "CN2 GIA", region: "上海" }],
};
const render = (input: ProbeServer) => renderToStaticMarkup(<NodeTelemetry server={input} tri={undefined} formatBytes={value => value === undefined ? "—" : `${value} B`} />);
const online = render(server);
check(online.includes("42.0 ms"), "Current latency is missing");
check(online.includes("150 B") && online.includes("100 B") && online.includes("已超额"), "Traffic fallback or overage is missing");
check(online.includes("CN2 GIA"), "Reported return route is missing");
check((online.match(/class="ping-row"/g) || []).length === 3, "Missing carriers must retain rows");
check((online.match(/class="ping-block /g) || []).length === 72, "Each carrier must have 24 slots");
check(online.includes("ping-block lost") && online.includes("ping-block partial"), "Loss states are indistinguishable");
check(online.includes("未上报"), "Missing routes must remain explicit");
const offline = render({ ...server, online: false, ping: [{ ...server.ping![0], buckets: [] }] });
check(!offline.includes("42.0 ms"), "Offline current latency must not show stale values");
check(render({ online: true, traffic_used: 0, traffic_limit: 0 }).includes("额度未设置"), "Unset quota must not imply zero percent");
