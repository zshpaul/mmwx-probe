import { authorized } from "./client-latency";

interface Env { CLIENT_LATENCY_DB?: D1Database; CLIENT_LATENCY_TOKEN?: string }
type Snapshot = {
  version: 1; group_id: string; revision: number; updated_at: string;
  upload_bytes: number | null; download_bytes: number | null; total_bytes: number | null; expires_at: string | null;
};
const json = (data: unknown, status = 200) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const groupValid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const utcValid = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19);
};
const bytesValid = (value: unknown) => value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
const columns = "group_id,revision,updated_at,upload_bytes,download_bytes,total_bytes,expires_at";

export async function clientQuota(request: Request, env: Env): Promise<Response> {
  const db = env.CLIENT_LATENCY_DB;
  if (!db) return json({ error: "not configured" }, 503);
  if (request.method === "GET") {
    const group = new URL(request.url).searchParams.get("group_id");
    if (!groupValid(group)) return json({ error: "invalid group" }, 400);
    const { results } = await db.prepare(`SELECT ${columns} FROM client_quota WHERE group_id = ?`).bind(group).all();
    return json({ version: 1, snapshot: results[0] ? { version: 1, ...results[0] } : null });
  }
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!env.CLIENT_LATENCY_TOKEN) return json({ error: "not configured" }, 503);
  if (!await authorized(request.headers.get("Authorization"), env.CLIENT_LATENCY_TOKEN)) return json({ error: "unauthorized" }, 401);
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return json({ error: "content type" }, 415);
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "invalid body" }, 400);
    const parts: Uint8Array[] = []; let length = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 4096) { await reader.cancel(); return json({ error: "body too large" }, 413); }
      parts.push(value);
    }
    const merged = new Uint8Array(length); let offset = 0;
    for (const part of parts) { merged.set(part, offset); offset += part.length; }
    body = JSON.parse(new TextDecoder().decode(merged));
  } catch { return json({ error: "invalid body" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid body" }, 400);
  const s = body as Snapshot;
  if (Object.keys(s).sort().join(",") !== "download_bytes,expires_at,group_id,revision,total_bytes,updated_at,upload_bytes,version" ||
      s.version !== 1 || !groupValid(s.group_id) || !Number.isSafeInteger(s.revision) || s.revision < 1 ||
      !utcValid(s.updated_at) || (s.expires_at !== null && !utcValid(s.expires_at)) ||
      !bytesValid(s.upload_bytes) || !bytesValid(s.download_bytes) || !bytesValid(s.total_bytes)) return json({ error: "invalid snapshot" }, 400);
  try {
    const write = await db.prepare(`INSERT INTO client_quota (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(group_id) DO UPDATE SET revision=excluded.revision, updated_at=excluded.updated_at,
      upload_bytes=excluded.upload_bytes, download_bytes=excluded.download_bytes, total_bytes=excluded.total_bytes, expires_at=excluded.expires_at
      WHERE excluded.revision > client_quota.revision`)
      .bind(s.group_id, s.revision, s.updated_at, s.upload_bytes, s.download_bytes, s.total_bytes, s.expires_at).run();
    const { results } = await db.prepare(`SELECT ${columns} FROM client_quota WHERE group_id = ?`).bind(s.group_id).all();
    const current = results[0] as Omit<Snapshot, "version"> | undefined;
    if (!current) return json({ error: "storage unavailable" }, 503);
    if (current.revision > s.revision) return json({ version: 1, group_id: s.group_id, revision: s.revision, disposition: "stale" });
    if (current.revision !== s.revision || (Object.keys(current) as (keyof typeof current)[]).some(key => current[key] !== s[key])) return json({ error: "revision conflict" }, 409);
    return json({ version: 1, group_id: s.group_id, revision: s.revision, disposition: write.meta.changes ? "stored" : "duplicate" });
  } catch { return json({ error: "storage unavailable" }, 503); }
}
