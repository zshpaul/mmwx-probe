interface LatencyEnv {
  CLIENT_LATENCY_DB?: D1Database;
  CLIENT_LATENCY_TOKEN?: string;
}

type Sample = {
  id: string;
  group_id: string;
  group_alias: string;
  measured_at: string;
  observed_at: string;
  node: string | null;
  status: "ok" | "failed" | "unknown";
  delay_ms: number | null;
  segment: string;
};

const maxBody = 32_768;
const retentionMs = 30 * 86400_000;
const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

function validSample(value: unknown, now: number): value is Sample {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>;
  if (Object.keys(s).sort().join(",") !== "delay_ms,group_alias,group_id,id,measured_at,node,observed_at,segment,status") return false;
  if (typeof s.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(s.id)) return false;
  if (typeof s.group_id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(s.group_id)) return false;
  if (typeof s.group_alias !== "string" || s.group_alias.length < 1 || s.group_alias.length > 80 || /[\u0000-\u001f\u007f]/.test(s.group_alias)) return false;
  if (typeof s.segment !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(s.segment)) return false;
  if (s.node !== null && (typeof s.node !== "string" || s.node.length < 1 || s.node.length > 80 || /[\u0000-\u001f\u007f]/.test(s.node))) return false;
  const utc = (v: unknown) => {
    if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(v)) return false;
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === v.slice(0, 19);
  };
  if (!utc(s.measured_at) || !utc(s.observed_at)) return false;
  const time = Date.parse(s.measured_at as string);
  const observed = Date.parse(s.observed_at as string);
  if (time < now - retentionMs || time > now + 300_000 || observed > now + 300_000 || observed < time - 300_000) return false;
  if (s.status === "ok") return typeof s.delay_ms === "number" && Number.isFinite(s.delay_ms) && s.delay_ms >= 0 && s.delay_ms <= 120_000;
  return (s.status === "failed" || s.status === "unknown") && s.delay_ms === null;
}

// Hash both values before comparison so secrets are never compared with an early exit.
export async function authorized(header: string | null, secret: string): Promise<boolean> {
  if (!header?.startsWith("Bearer ") || !secret) return false;
  const encode = (text: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const [left, right] = await Promise.all([encode(header.slice(7)), encode(secret)]);
  const a = new Uint8Array(left), b = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export async function clientLatency(request: Request, env: LatencyEnv): Promise<Response> {
  const db = env.CLIENT_LATENCY_DB;
  if (request.method === "GET") {
    if (!db) return json({ error: "not configured" }, 503);
    const cutoff = Date.now() - retentionMs;
    const url = new URL(request.url);
    const group = url.searchParams.get("group");
    const rawLimit = url.searchParams.get("limit");
    if (group !== null && !/^[A-Za-z0-9_-]{1,80}$/.test(group)) return json({ error: "invalid group" }, 400);
    if (rawLimit !== null && !/^[1-9]\d{0,4}$/.test(rawLimit)) return json({ error: "invalid limit" }, 400);
    const limit = rawLimit === null ? 10000 : Number(rawLimit);
    if (limit > 10000) return json({ error: "invalid limit" }, 400);
    if (url.searchParams.get("paged") === "1") {
      const cursor = url.searchParams.get("cursor");
      const parts = cursor === null ? null : cursor.split(".").map(Number);
      if (parts && (parts.length !== 3 || parts.some(n => !Number.isSafeInteger(n) || n < 0) || !/^\d+\.\d+\.\d+$/.test(cursor!))) return json({ error: "invalid cursor" }, 400);
      const snapshot = parts ? parts[0] : Number((await db.prepare("SELECT COALESCE(MAX(rowid), 0) AS max_rowid FROM client_latency").all()).results[0]?.max_rowid ?? 0);
      const beforeTime = parts ? parts[1] : Number.MAX_SAFE_INTEGER;
      const beforeRow = parts ? parts[2] : Number.MAX_SAFE_INTEGER;
      const { results } = await db.prepare(`SELECT rowid AS page_rowid, measured_ms AS page_time, group_id, group_alias, node, measured_at, status, delay_ms, segment
        FROM client_latency WHERE measured_ms >= ? AND (? IS NULL OR group_id = ?) AND rowid <= ?
        AND (measured_ms < ? OR (measured_ms = ? AND rowid < ?))
        ORDER BY measured_ms DESC, rowid DESC LIMIT ?`)
        .bind(cutoff, group, group, snapshot, beforeTime, beforeTime, beforeRow, limit).all();
      const last = results[results.length - 1] as Record<string, unknown> | undefined;
      const next_cursor = results.length === limit && last ? `${snapshot}.${last.page_time}.${last.page_rowid}` : null;
      const samples = results.map(({ page_rowid: _rowid, page_time: _time, ...sample }) => sample);
      return json({ version: 1, samples, next_cursor });
    }
    const { results } = await db.prepare(
      "SELECT group_id, group_alias, node, measured_at, status, delay_ms, segment FROM (SELECT group_id, group_alias, node, measured_at, status, delay_ms, segment, measured_ms, id FROM client_latency WHERE measured_ms >= ? AND (? IS NULL OR group_id = ?) ORDER BY measured_ms DESC, id DESC LIMIT ?) ORDER BY measured_ms ASC, id ASC"
    ).bind(cutoff, group, group, limit).all();
    return json({ version: 1, samples: results });
  }
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!env.CLIENT_LATENCY_TOKEN || !db) return json({ error: "not configured" }, 503);
  if (!await authorized(request.headers.get("Authorization"), env.CLIENT_LATENCY_TOKEN)) return json({ error: "unauthorized" }, 401);
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return json({ error: "content type" }, 415);
  const length = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(length) && length > maxBody) return json({ error: "body too large" }, 413);
  let body: unknown;
  try {
    // Bound the body even when Content-Length is absent or incorrect.
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "invalid body" }, 400);
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBody) { await reader.cancel(); return json({ error: "body too large" }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return json({ error: "invalid body" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid body" }, 400);
  const payload = body as Record<string, unknown>;
  if (Object.keys(payload).sort().join(",") !== "samples,version" || payload.version !== 1 || !Array.isArray(payload.samples) || !payload.samples.length || payload.samples.length > 100) return json({ error: "invalid batch" }, 400);
  const now = Date.now();
  if (!payload.samples.every(s => validSample(s, now))) return json({ error: "invalid sample" }, 400);
  const samples = payload.samples as Sample[];
  if (new Set(samples.map(s => s.id)).size !== samples.length) return json({ error: "duplicate id in batch" }, 400);
  const statements = [
    db.prepare("DELETE FROM client_latency WHERE measured_ms < ?").bind(now - retentionMs),
    ...samples.map(s => db.prepare(`INSERT INTO client_latency (writer_id, id, group_id, group_alias, measured_at, measured_ms, observed_at, node, status, delay_ms, segment)
      VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(writer_id, id) DO UPDATE SET id = CASE WHEN
        group_id IS excluded.group_id AND group_alias IS excluded.group_alias AND measured_at IS excluded.measured_at
        AND observed_at IS excluded.observed_at AND node IS excluded.node AND status IS excluded.status
        AND delay_ms IS excluded.delay_ms AND segment IS excluded.segment THEN id ELSE NULL END`)
      .bind(s.id, s.group_id, s.group_alias, s.measured_at, Date.parse(s.measured_at), s.observed_at, s.node, s.status, s.delay_ms, s.segment)),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (String(error).includes("NOT NULL constraint failed")) return json({ error: "sample id conflict" }, 409);
    return json({ error: "storage unavailable" }, 503);
  }
  return json({ version: 1, accepted: samples.map(s => s.id) });
}
