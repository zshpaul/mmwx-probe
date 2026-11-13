import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = resolve(process.argv[2] || "");
const data = await mkdtemp(join(tmpdir(), "meowx-runtime-test-"));
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise(done => reservation.close(done));
const token = "isolated-runtime-test";
const endpoint = `http://127.0.0.1:${port}`;
let child;
async function start() {
  child = spawn(join(root, "node.exe"), [join(root, "server.mjs"), "--data-dir", data, "--port", String(port)], { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdin.write(JSON.stringify({ token }) + "\n");
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Startup timed out: ${stderr}`)), 10000);
    child.stdout.on("data", chunk => { if (String(chunk).includes("READY")) { clearTimeout(timeout); resolveReady(); } });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Startup exited: ${code}, ${stderr}`)); });
  });
}
async function stop() {
  const exited = once(child, "exit");
  child.stdin.end();
  const [code] = await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("EOF shutdown timed out")), 7000))]);
  assert.equal(code, 0);
}
const sample = id => ({
  id, group_id: "synthetic-group", group_alias: "Synthetic", measured_at: new Date().toISOString(),
  observed_at: new Date().toISOString(), node: null, status: "ok", delay_ms: 37, segment: "segment-a",
});
const post = (samples, credential = token) => fetch(`${endpoint}/api/client-latency/v1/samples`, {
  method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body: JSON.stringify({ version: 1, samples }),
});
const quotaUrl = `${endpoint}/api/client-quota/v1/snapshot`;
const quota = { version: 1, group_id: "synthetic-group", revision: 1, updated_at: "2026-11-13T03:00:00.123456Z", upload_bytes: 10, download_bytes: 30, total_bytes: 100, expires_at: null };
const postQuota = (value, credential = token) => fetch(quotaUrl, { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body: JSON.stringify(value) });
const getQuota = async () => (await (await fetch(`${quotaUrl}?group_id=synthetic-group`)).json()).snapshot;
const rateUrl = `${endpoint}/api/client-rate/v1/snapshot`;
const rate = { version: 1, group_id: "synthetic-group", observed_at: new Date().toISOString(), status: "ok", upload_bps: 37, download_bps: 88 };
const postRate = (value, credential = token) => fetch(rateUrl, { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body: JSON.stringify(value) });
const getRate = async () => (await (await fetch(`${rateUrl}?group_id=synthetic-group`)).json());
try {
  await start();
  assert.deepEqual(await (await fetch(`${endpoint}/api/local/health`)).json(), { service: "meowx-client-latency", version: 1 });
  assert.equal((await (await fetch(`${endpoint}/api/probe`)).json()).local_client_only, true);
  assert.equal((await fetch(endpoint)).status, 200);
  assert.equal((await postQuota(quota, "wrong")).status, 401);
  assert.equal((await (await postQuota(quota)).json()).disposition, "stored");
  assert.equal((await (await postQuota(quota)).json()).disposition, "duplicate");
  assert.equal((await postQuota({ ...quota, download_bytes: 31 })).status, 409);
  const reset = { ...quota, revision: 2, upload_bytes: 1, download_bytes: 2 };
  assert.equal((await (await postQuota(reset)).json()).disposition, "stored");
  assert.equal((await (await postQuota(quota)).json()).disposition, "stale");
  assert.deepEqual(await getQuota(), reset);
  assert.equal((await postQuota({ ...quota, revision: 3, total_bytes: -1 })).status, 400);
  assert.equal((await postRate(rate, "wrong")).status, 401);
  assert.equal((await (await postRate(rate)).json()).disposition, "stored");
  assert.equal((await (await postRate(rate)).json()).disposition, "duplicate");
  assert.equal((await postRate({ ...rate, upload_bps: 38 })).status, 409);
  assert.equal((await (await postRate({ ...rate, observed_at: new Date(Date.parse(rate.observed_at) - 1000).toISOString() })).json()).disposition, "stale");
  assert.equal((await postRate({ ...rate, observed_at: new Date(Date.now() - 31_000).toISOString() })).status, 400);
  assert.equal((await postRate({ ...rate, observed_at: new Date(Date.now() + 10_000).toISOString() })).status, 400);
  assert.equal((await getRate()).snapshot.upload_bps, 37);
  const testDb = new DatabaseSync(join(data, "client-latency.sqlite"));
  testDb.prepare("UPDATE client_rate SET received_ms = ? WHERE group_id = ?").run(Date.now() - 31_000, rate.group_id);
  testDb.close();
  assert.equal((await getRate()).expires_in_ms, 0);
  assert.equal((await (await postRate(rate)).json()).disposition, "duplicate");
  assert.equal((await getRate()).expires_in_ms, 0);
  const unknown = { ...rate, observed_at: new Date(Date.parse(rate.observed_at) + 1).toISOString(), status: "unknown", upload_bps: null, download_bps: null };
  assert.equal((await postRate(unknown)).status, 200);
  assert.equal((await getRate()).snapshot.status, "unknown");
  assert.equal((await postRate({ ...unknown, upload_bps: 0 })).status, 400);
  const zero = { ...rate, observed_at: new Date(Date.parse(rate.observed_at) + 2).toISOString(), upload_bps: 0, download_bps: 0 };
  assert.equal((await postRate(zero)).status, 200);
  assert.equal((await getRate()).snapshot.upload_bps, 0);
  const one = sample("one");
  assert.equal((await post([one], "wrong")).status, 401);
  assert.deepEqual((await (await post([one])).json()).accepted, ["one"]);
  assert.deepEqual((await (await post([one])).json()).accepted, ["one"]);
  const conflict = await post([sample("two"), { ...one, delay_ms: 38 }]);
  assert.equal(conflict.status, 409);
  const failed = { ...sample("failed"), status: "failed", delay_ms: null };
  assert.equal((await post([failed])).status, 200);
  let history = await (await fetch(`${endpoint}/api/client-latency/v1/samples`)).json();
  assert.equal(history.samples.length, 2);
  assert.equal(history.samples.some(item => item.status === "failed" && item.delay_ms === null), true);
  assert.equal(Object.keys(history.samples[0]).sort().join(","), "delay_ms,group_alias,group_id,measured_at,node,segment,status");
  await stop();
  await start();
  assert.deepEqual(await getQuota(), reset);
  history = await (await fetch(`${endpoint}/api/client-latency/v1/samples`)).json();
  assert.equal(history.samples.length, 2);
  assert.equal((await post([one])).status, 200);
  assert.equal((await (await fetch(`${endpoint}/api/client-latency/v1/samples`)).json()).samples.length, 2);
  const sameTime = new Date().toISOString();
  const tiedA = { ...sample("tied-a"), measured_at: sameTime, group_id: "pagination-group" };
  const tiedB = { ...sample("tied-b"), measured_at: sameTime, group_id: "pagination-group", delay_ms: 38 };
  assert.equal((await post([tiedA, tiedB])).status, 200);
  const many = Array.from({ length: 12 }, (_, i) => ({ ...sample(`summary-${i}`), group_id: "summary-group", measured_at: sameTime, delay_ms: i }));
  assert.equal((await post(many)).status, 200);
  const summary = await (await fetch(`${endpoint}/api/client-latency/v1/samples?summary=1`)).json();
  assert.equal(summary.samples.filter(item => item.group_id === "pagination-group").length, 2);
  assert.ok(summary.samples.some(item => item.group_id === "synthetic-group"));
  assert.deepEqual(summary.samples.filter(item => item.group_id === "summary-group").map(item => item.delay_ms), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const pageUrl = `${endpoint}/api/client-latency/v1/samples?paged=1&limit=1&group=pagination-group`;
  const first = await (await fetch(pageUrl)).json();
  assert.equal(first.samples.length, 1);
  assert.equal(first.samples[0].delay_ms, 38);
  assert.equal(Object.hasOwn(first.samples[0], "page_rowid"), false);
  assert.ok(first.next_cursor);
  assert.equal((await post([{ ...sample("later"), group_id: "pagination-group", measured_at: sameTime, delay_ms: 39 }])).status, 200);
  const incrementalUrl = `${endpoint}/api/client-latency/v1/samples?after=${first.snapshot}&limit=1&group=pagination-group`;
  const increment = await (await fetch(incrementalUrl)).json();
  assert.equal(increment.samples.length, 1);
  assert.equal(increment.samples[0].delay_ms, 39);
  assert.ok(increment.next_after > first.snapshot);
  assert.equal(increment.has_more, true);
  const noMore = await (await fetch(`${endpoint}/api/client-latency/v1/samples?after=${increment.next_after}&group=pagination-group`)).json();
  assert.deepEqual(noMore.samples, []);
  assert.equal(noMore.has_more, false);
  assert.equal((await fetch(`${endpoint}/api/client-latency/v1/samples?after=0`)).status, 400);
  const second = await (await fetch(`${pageUrl}&cursor=${first.next_cursor}`)).json();
  assert.equal(second.samples[0].delay_ms, 37);
  const third = await (await fetch(`${pageUrl}&cursor=${second.next_cursor}`)).json();
  assert.equal(third.samples.length, 0);
  assert.equal(third.next_cursor, null);
  assert.equal((await fetch(`${pageUrl}&cursor=invalid`)).status, 400);
  await stop();
  assert.equal((await readFile(join(root, "dist", "index.html"))).length > 0, true);
  console.log("PASS: standalone startup, EOF shutdown, authorization, idempotency, atomic conflict rollback, projection, failure, persistence");
} finally {
  if (child && child.exitCode === null) child.kill();
}
