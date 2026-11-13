import { authorized } from "./client-latency";

interface Env { CLIENT_LATENCY_DB?: D1Database; CLIENT_LATENCY_TOKEN?: string }
type Snapshot = {
  version: 1; group_id: string; observed_at: string; status: "ok" | "unknown";
  upload_bps: number | null; download_bps: number | null;
};
type Stored = Omit<Snapshot, "version"> & { received_ms: number };
const ttl = 30_000;
const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const groupValid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const utcValid = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};
const validRate = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const fields = "group_id,observed_at,received_ms,status,upload_bps,download_bps";

export async function clientRate(request: Request, env: Env): Promise<Response> {
  const db = env.CLIENT_LATENCY_DB;
  if (!db) return json({ error: "not configured" }, 503);
  if (request.method === "GET") {
    const group = new URL(request.url).searchParams.get("group_id");
    if (!groupValid(group)) return json({ error: "invalid group" }, 400);
    try {
      const { results } = await db.prepare(`SELECT ${fields} FROM client_rate WHERE group_id = ?`).bind(group).all();
      const row = results[0] as Stored | undefined;
      if (!row) return json({ version: 1, snapshot: null, expires_in_ms: 0 });
      const now = Date.now();
      const expires = Math.max(0, Math.min(ttl, row.received_ms + ttl - now, Date.parse(row.observed_at) + ttl - now));
      const { received_ms: _received, ...snapshot } = row;
      return json({ version: 1, snapshot: { version: 1, ...snapshot }, expires_in_ms: expires });
    } catch { return json({ error: "storage unavailable" }, 503); }
  }
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!env.CLIENT_LATENCY_TOKEN) return json({ error: "not configured" }, 503);
  if (!await authorized(request.headers.get("Authorization"), env.CLIENT_LATENCY_TOKEN)) return json({ error: "unauthorized" }, 401);
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return json({ error: "content type" }, 415);
  let value: unknown;
  try {
    const reader = request.body?.getReader(); if (!reader) return json({ error: "invalid body" }, 400);
    const chunks: Uint8Array[] = []; let length = 0;
    for (;;) {
      const { done, value: chunk } = await reader.read(); if (done) break;
      length += chunk.length;
      if (length > 4096) { await reader.cancel(); return json({ error: "body too large" }, 413); }
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return json({ error: "invalid body" }, 400); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return json({ error: "invalid body" }, 400);
  const s = value as Snapshot;
  const now = Date.now();
  if (Object.keys(s).sort().join(",") !== "download_bps,group_id,observed_at,status,upload_bps,version" ||
      s.version !== 1 || !groupValid(s.group_id) || !utcValid(s.observed_at) ||
      Date.parse(s.observed_at) < now - ttl || Date.parse(s.observed_at) > now + 5_000 ||
      !((s.status === "ok" && validRate(s.upload_bps) && validRate(s.download_bps)) ||
        (s.status === "unknown" && s.upload_bps === null && s.download_bps === null))) return json({ error: "invalid snapshot" }, 400);
  try {
    const written = await db.prepare(`INSERT INTO client_rate (${fields}) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(group_id) DO UPDATE SET observed_at=excluded.observed_at,received_ms=excluded.received_ms,
      status=excluded.status,upload_bps=excluded.upload_bps,download_bps=excluded.download_bps
      WHERE excluded.observed_at > client_rate.observed_at`)
      .bind(s.group_id, s.observed_at, now, s.status, s.upload_bps, s.download_bps).run();
    const { results } = await db.prepare(`SELECT ${fields} FROM client_rate WHERE group_id = ?`).bind(s.group_id).all();
    const current = results[0] as Stored | undefined;
    if (!current) return json({ error: "storage unavailable" }, 503);
    if (current.observed_at > s.observed_at) return json({ version: 1, group_id: s.group_id, observed_at: s.observed_at, disposition: "stale" });
    if (current.observed_at !== s.observed_at || current.status !== s.status || current.upload_bps !== s.upload_bps || current.download_bps !== s.download_bps) return json({ error: "timestamp conflict" }, 409);
    return json({ version: 1, group_id: s.group_id, observed_at: s.observed_at, disposition: written.meta.changes ? "stored" : "duplicate" });
  } catch { return json({ error: "storage unavailable" }, 503); }
}
