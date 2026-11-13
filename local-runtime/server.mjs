import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { clientLatency } from "./client-latency.mjs";
import { clientQuota } from "./client-quota.mjs";
import { clientRate } from "./client-rate.mjs";

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--data-dir", "--port"].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error("Invalid arguments");
  options[args[i]] = args[i + 1];
}
if (!options["--data-dir"]) throw new Error("Missing data directory");
const port = Number(options["--port"] || 8796);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");

// The supervisor sends the existing upload secret through a private pipe, not argv or disk.
let input = "";
let parentClosed = false;
let stopOnParentClose = () => {};
process.stdin.setEncoding("utf8");
process.stdin.on("end", () => { parentClosed = true; stopOnParentClose(); });
const startup = await new Promise((resolveStartup, rejectStartup) => {
  const onData = chunk => {
    input += chunk;
    if (input.length > 4096) { process.stdin.off("data", onData); rejectStartup(new Error("Startup input too large")); return; }
    const newline = input.indexOf("\n");
    if (newline < 0) return;
    process.stdin.off("data", onData);
    try { resolveStartup(JSON.parse(input.slice(0, newline))); } catch { rejectStartup(new Error("Invalid startup input")); }
    input = "";
    process.stdin.resume();
  };
  process.stdin.on("data", onData);
  process.stdin.once("end", () => rejectStartup(new Error("Missing startup input")));
  process.stdin.once("error", rejectStartup);
});
if (typeof startup.token !== "string" || !startup.token || startup.token.length > 512) throw new Error("Invalid startup token");
const token = startup.token;
delete startup.token;

const dataDir = resolve(options["--data-dir"]);
const assets = resolve(dirname(fileURLToPath(import.meta.url)), "dist");
await mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, "client-latency.sqlite"));
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
db.exec(`CREATE TABLE IF NOT EXISTS client_latency (
  writer_id TEXT NOT NULL, id TEXT NOT NULL, group_id TEXT NOT NULL, group_alias TEXT NOT NULL,
  measured_at TEXT NOT NULL, measured_ms INTEGER NOT NULL, observed_at TEXT NOT NULL, node TEXT,
  status TEXT NOT NULL, delay_ms REAL, segment TEXT NOT NULL, PRIMARY KEY (writer_id,id));
  CREATE INDEX IF NOT EXISTS client_latency_measured_ms ON client_latency(measured_ms);
  CREATE INDEX IF NOT EXISTS client_latency_group_time ON client_latency(group_id,measured_ms);`);
db.exec(`CREATE TABLE IF NOT EXISTS client_latency_sequence (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  writer_id TEXT NOT NULL,
  id TEXT NOT NULL,
  UNIQUE (writer_id, id)
);
INSERT OR IGNORE INTO client_latency_sequence (writer_id, id)
  SELECT source.writer_id, source.id FROM client_latency AS source
  WHERE NOT EXISTS (SELECT 1 FROM client_latency_sequence AS seq WHERE seq.writer_id = source.writer_id AND seq.id = source.id)
  ORDER BY source.rowid;
CREATE TRIGGER IF NOT EXISTS client_latency_sequence_insert AFTER INSERT ON client_latency BEGIN
  INSERT INTO client_latency_sequence (writer_id, id) VALUES (NEW.writer_id, NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS client_latency_sequence_delete AFTER DELETE ON client_latency BEGIN
  DELETE FROM client_latency_sequence WHERE writer_id = OLD.writer_id AND id = OLD.id;
END;
`);
db.exec(`CREATE TABLE IF NOT EXISTS client_quota (
  group_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at TEXT NOT NULL,
  upload_bytes INTEGER, download_bytes INTEGER, total_bytes INTEGER, expires_at TEXT);`);
db.exec(`CREATE TABLE IF NOT EXISTS client_rate (
  group_id TEXT PRIMARY KEY, observed_at TEXT NOT NULL, received_ms INTEGER NOT NULL,
  status TEXT NOT NULL, upload_bps INTEGER, download_bps INTEGER);`);

class BoundStatement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new BoundStatement(this.sql, values); }
  async all() { return { results: db.prepare(this.sql).all(...this.values) }; }
  async run() { const result = db.prepare(this.sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; }
}
const adapter = {
  prepare: sql => new BoundStatement(sql),
  async batch(statements) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = statements.map(statement => db.prepare(statement.sql).run(...statement.values));
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },
};

const json = (res, value, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(value));
};
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/api/local/health" && req.method === "GET") {
      db.prepare("SELECT 1 FROM client_latency LIMIT 1").all();
      return json(res, { service: "meowx-client-latency", version: 1 });
    }
    if (url.pathname === "/api/client-latency/v1/samples" || url.pathname === "/api/client-quota/v1/snapshot" || url.pathname === "/api/client-rate/v1/snapshot") {
      const chunks = [];
      let total = 0;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > 32768) return json(res, { error: "body too large" }, 413);
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const request = new Request(url, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) });
      const handler = url.pathname === "/api/client-rate/v1/snapshot" ? clientRate : url.pathname === "/api/client-quota/v1/snapshot" ? clientQuota : clientLatency;
      const result = await handler(request, { CLIENT_LATENCY_DB: adapter, CLIENT_LATENCY_TOKEN: token });
      res.writeHead(result.status, Object.fromEntries(result.headers.entries()));
      return res.end(Buffer.from(await result.arrayBuffer()));
    }
    if (url.pathname === "/api/probe" && req.method === "GET") return json(res, { enabled: true, local_client_only: true, servers: [] });
    if (url.pathname === "/api/visitor" && req.method === "GET") return json(res, { countryCode: "", city: "", region: "", maskedIp: "" });
    if (url.pathname.startsWith("/api/")) return json(res, { error: "not available" }, 404);
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, { error: "method not allowed" }, 405);
    const path = resolve(assets, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
    if (path !== assets && !path.startsWith(assets + sep)) return json(res, { error: "not found" }, 404);
    const data = await readFile(path);
    res.writeHead(200, { "Content-Type": mime[extname(path).toLowerCase()] || "application/octet-stream", "X-Content-Type-Options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch (error) {
    if (!res.headersSent) json(res, { error: error?.code === "ENOENT" ? "not found" : "service unavailable" }, error?.code === "ENOENT" ? 404 : 500);
    else res.destroy();
  }
});
const cleanup = setInterval(() => {
  try { db.prepare("DELETE FROM client_latency WHERE measured_ms < ?").run(Date.now() - 30 * 86400_000); }
  catch { console.error("Scheduled retention cleanup failed"); }
}, 24 * 3600_000);
cleanup.unref();
server.on("error", () => { db.close(); process.exit(1); });
server.listen(port, "127.0.0.1", () => console.log(`READY 127.0.0.1:${port}`));
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(cleanup);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
stopOnParentClose = stop;
if (parentClosed) stop();
