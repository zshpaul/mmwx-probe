import { renderToStaticMarkup } from "react-dom/server";
import { ServerDetails } from "./ServerDetails";
import type { ProbeServer } from "./types";

const assert = {
  ok(condition: boolean, message = "Unexpected detail markup") {
    if (!condition) throw new Error(message);
  },
};
const render = (server: ProbeServer) => renderToStaticMarkup(<ServerDetails server={server} index={0} updatedAt={Date.parse("2026-11-10")} />);
const missing = render({ online: true, name: "Minimal" });
for (const absent of ["硬件信息", "系统信息", "存储信息", "网络信息", "节点价格", "三网", "GPU", "内存交换", "启动时间", "最后上报"]) assert.ok(!missing.includes(absent), absent);
const populated = render({
  online: true, cpu_model: "Example CPU", cpu_cores: 2, cpu_threads: 4, mem_total: 2e9, disk_total: 20e9,
  os: "Linux", kernel: "6.1", arch: "amd64", uptime: 100000,
  renewal_price_cny: 365, renewal_cycle: "year", expires_at: "2026-11-20",
  traffic_used: 0, upload_speed: 0, download_speed: 0,
});
for (const present of ["硬件信息", "系统信息", "存储信息", "网络信息", "节点价格", "月均支出", "剩余时间", "剩余价值", "12H", "0 B/s"]) assert.ok(populated.includes(present), present);
assert.ok(!populated.includes("最后上报"));
assert.ok(!populated.includes("无限流量"));
assert.ok(render({ online: false, last_seen: "2026-11-09T00:00:00Z" }).includes("最后上报"));
