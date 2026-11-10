import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const clients = new Set();
let stream = true;
let silent = false;
let failure = false;
let empty = false;
let disabled = false;
let historyFailure = false;
let revision = 0;
let frozen = false;
const requests = [];
const gib = 1024 ** 3;
const locations = [
  ["香港 · 01", "中国香港", "香港", "Debian 12", 4, 8],
  ["Tokyo Edge", "日本", "东京", "Ubuntu 24.04", 2, 4],
  ["Singapore Core", "新加坡", "新加坡", "Debian 12", 8, 16],
  ["Los Angeles", "美国", "洛杉矶", "Ubuntu 24.04", 4, 8],
  ["Frankfurt · EU", "德国", "法兰克福", "Rocky Linux 9", 2, 4],
  ["备用节点 · Maintenance", "英国", "伦敦", "Debian 12", 2, 2],
];
function payload() {
  return {
    enabled: !disabled, title: "Ignored upstream branding", history_days: 7,
    appearance: { theme: "pixel", color_mode: "light" },
    servers: empty ? [] : locations.map(([name, region_name, region_city, os, cpu_cores, memory], index) => ({
      name, region_name, region_city, os, cpu_cores,
      cpu_model: "AMD EPYC 7B13", arch: "x86_64",
      online: index !== 5, last_seen: index === 5 ? "2026-11-09T05:30:00Z" : undefined,
      cpu_pct: index === 4 ? undefined : 12 + index * 13 + revision % 15,
      mem_used: memory * gib * (0.24 + index * 0.09), mem_total: memory * gib,
      disk_used: (12 + index * 9) * gib, disk_total: 100 * gib,
      upload_speed: 350000 + index * 670000 + revision * 1000,
      download_speed: 2200000 + index * 580000 + revision * 1000,
      traffic_used: (128 + index * 73) * gib, traffic_limit: 1000 * gib,
      uptime: 86400 * (32 + index * 12), tcp_connections: 38 + revision, udp_connections: 12,
      traffic_used_scope: "configured_period", traffic_source: "xray", traffic_stats_mode: "both",
      ping: index === 4 ? [] : ["telecom", "unicom", "mobile"].filter((_, carrier) => index !== 1 || carrier !== 2).map((isp, carrier) => ({
        key: `target-${carrier}`, isp, label: ["上海电信", "北京联通", "广州移动"][carrier],
        current_ms: 36 + index * 24 + carrier * 13, loss_pct: carrier === 1 ? 2.5 : 0,
        buckets: Array.from({ length: 24 }, (_, bucket) => ({
          ms: bucket === 7 && carrier === 2 ? -1 : 30 + index * 24 + carrier * 13 + Math.sin(bucket * 0.7) * 20,
          loss: bucket === 7 && carrier === 2 ? 100 : bucket % 9 === carrier ? 2.5 : 0,
        })),
      })),
      return_routes: index === 4 ? [] : ["telecom", "unicom", "mobile"].map((carrier, route) => ({
        carrier, region: ["上海", "北京", "广州"][route], route_type: ["CN2 GIA", "AS9929", "CMI"][route],
        tested_at: "2026-11-10T00:00:00Z",
      })),
    })),
  };
}
function frame(text, opcode = 1) {
  const body = Buffer.from(text);
  const header = Buffer.alloc(body.length < 126 ? 2 : 4);
  header[0] = 0x80 | opcode;
  header[1] = body.length < 126 ? body.length : 126;
  if (body.length >= 126) header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, body]);
}
export function series(url) {
  const range = url.searchParams.get("range") || "1h";
  const days = parseInt(range);
  const bucket = range === "1h" ? 300 : range === "6h" ? 600 : range === "24h" ? 1800 : days <= 3 ? 3600 : 7200;
  const count = range === "1h" ? 12 : range === "6h" ? 36 : range === "24h" ? 48 : days * 86400 / bucket;
  const end = Math.floor(Date.now() / 1000 / bucket) * bucket;
  const meta = { success: true, generated_at: end, bucket_sec: bucket, buckets: count };
  const points = (base, amplitude) => Array.from({ length: count }, (_, index) => ({
    t: end - (count - 1 - index) * bucket,
    value: base + Math.sin(index * 0.7) * amplitude + (index % 4) * amplitude * 0.2,
  }));
  if (url.searchParams.get("metric") === "system") return {
    ...meta,
    series: {
      cpu_pct: points(24, 13), mem_used: points(3.2 * gib, 0.4 * gib), mem_total: points(8 * gib, 0),
      disk_used: points(22 * gib, 0.3 * gib), disk_total: points(100 * gib, 0),
      upload_speed: points(1800000, 600000), download_speed: points(3300000, 1200000),
    },
  };
  const targets = ["电信 · 上海", "联通 · 北京", "移动 · 广州"].map((label, line) => ({
      key: `target-${line}`, label, isp: ["telecom", "unicom", "mobile"][line], current_ms: 34 + line * 12, loss_pct: 0,
      buckets: Array.from({ length: count }, (_, index) => ({
        ms: 28 + line * 17 + Math.sin(index * 0.6 + line) * 6 + (index % 3) * 3,
        loss: index % 9 === line + 3 ? 2.5 + line : 0,
      })),
    }));
  return {
    success: true, generated_at: end, bucket_sec: bucket,
    series: {
      key: "__avg__", label: "平均", current_ms: targets.reduce((total, target) => total + target.current_ms, 0) / targets.length, loss_pct: 0,
      buckets: Array.from({ length: count }, (_, index) => ({
        ms: targets.reduce((total, target) => total + target.buckets[index].ms, 0) / targets.length,
        loss: targets.reduce((total, target) => total + target.buckets[index].loss, 0) / targets.length,
      })),
    },
    ...(url.searchParams.get("all") === "1" ? { all_series: targets } : {}),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const json = (body, status = 200) => {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
  };
  if (url.pathname === "/__qa/control" && request.method === "POST") {
    frozen = url.searchParams.get("freeze") === "1";
    stream = url.searchParams.get("stream") !== "off";
    silent = url.searchParams.get("silent") === "1";
    failure = url.searchParams.get("failure") === "1";
    historyFailure = url.searchParams.get("historyFailure") === "1";
    empty = url.searchParams.get("empty") === "1";
    disabled = url.searchParams.get("disabled") === "1";
    if (!stream) for (const client of clients) client.end(frame("", 8));
    return json({ stream, silent, failure, empty, disabled });
  }
  if (url.pathname === "/__qa/state") return json({ revision, requests: requests.slice(-100), clients: clients.size });
  if (url.pathname === "/__qa" && process.env.PROBE_QA_FILE) {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(await readFile(process.env.PROBE_QA_FILE));
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    requests.push(url.pathname + url.search);
    if (requests.length > 200) requests.shift();
  }
  if (url.pathname === "/api/probe") return json(payload(), failure ? 503 : 200);
  if (url.pathname === "/api/series") return json(series(url), historyFailure ? 503 : 200);
  json({ error: "fixture endpoint not found" }, 404);
});
server.on("upgrade", (request, socket) => {
  if (request.url !== "/api/stream" || !stream) {
    socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    return;
  }
  const accept = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  clients.add(socket);
  if (!silent) socket.write(frame(JSON.stringify(payload())));
  socket.on("data", data => { if ((data[0] & 0x0f) === 8) socket.end(frame("", 8)); });
  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
});
setInterval(() => {
  if (!frozen) revision++;
  if (!silent) for (const socket of clients) socket.write(frame(JSON.stringify(payload())));
}, 2000).unref();
server.listen(8788, "127.0.0.1", () => console.log("Mock probe listening on http://127.0.0.1:8788 (local fixtures only)"));
}
