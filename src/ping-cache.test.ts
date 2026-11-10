import { PingCache, pingRefreshInterval, pingCacheIdleMs, pingNodeIdentity, emptyPingSnapshot, pingCache } from "./ping-cache";
import type { PingResponse } from "./emerald-ping";
import { subscribePingHistory } from "./use-ping-history";

function check(value: boolean, message: string) { if (!value) throw new Error(message); }
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
async function run() {
  let calls = 0;
  let clock = 1000;
  const completions: ((data: PingResponse) => void)[] = [];
  const cache = new PingCache(() => { calls++; return new Promise(resolve => completions.push(resolve)); }, () => clock, 3);
  const cleanups = [
    cache.subscribe(0, "1h", () => {}),
    cache.subscribe(0, "1h", () => {}),
    cache.subscribe(0, "1h", () => {}),
    ...[1, 2, 3].map(index => cache.subscribe(index, "1h", () => {})),
  ];
  await flush();
  check(calls === 3, "Deduplicate consumers and cap concurrent requests at three");
  const body: PingResponse = { generated_at: 36000, bucket_sec: 300, all_series: [] };
  completions.shift()!(body);
  await flush();
  check(calls === 4 && cache.snapshot(0, "1h").data === body, "Serve shared response and release queue");
  completions.splice(0).forEach(resolve => resolve(body));
  await flush();
  const unsubscribe = cache.subscribe(0, "1h", () => {});
  await flush();
  check(calls === 4, "Cached remount should not refetch");
  cache.setVisible(false);
  clock += 300001;
  await flush();
  check(calls === 4, "Hidden page must not refresh");
  cache.setVisible(true);
  await flush();
  check(calls === 7, "Visible page should resume due requests with cap");
  cache.setVisible(false);
  completions.splice(0).forEach(resolve => resolve(body));
  await flush();
  check(calls === 7, "Hidden queue should not start further requests");
  cleanups.forEach(cleanup => cleanup());
  unsubscribe();
  clock += pingCacheIdleMs + 1;
  cache.setVisible(false);
  check(cache.snapshot(0, "1h") === emptyPingSnapshot, "Unused cache entries are collected");
  const failed = new PingCache(() => { throw new Error("Synchronous network failure"); }, () => clock);
  const stop = failed.subscribe(0, "1h", () => {});
  await flush();
  check(failed.snapshot(0, "1h").error === "加载失败" && !failed.snapshot(0, "1h").data, "Catch synchronous failure without stale bars");
  stop();
  clock += pingCacheIdleMs + 1;
  failed.setVisible(false);
  check(pingRefreshInterval(30) === 60000 && pingRefreshInterval(300) === 300000 && pingRefreshInterval(undefined) === 60000, "Refresh interval must respect buckets and minimum");

  const attempts: { index: number; time: number }[] = [];
  const timeouts: (() => void)[] = [];
  const fair = new PingCache(index => {
    attempts.push({ index, time: clock });
    return new Promise((_, reject) => timeouts.push(() => reject(new Error("10 second timeout"))));
  }, () => clock, 3);
  const start = clock;
  const remove = Array.from({ length: 30 }, (_, index) => fair.subscribe(index, "1h", () => {}));
  await flush();
  for (let batch = 0; batch < 9; batch++) {
    clock += 10000;
    timeouts.splice(0).forEach(timeout => timeout());
    await flush();
  }
  check(attempts.length === 30 && new Set(attempts.map(attempt => attempt.index)).size === 30, "Thirty nodes must all get a first request before any retry");
  check(attempts.every(attempt => attempt.time - start <= 90000), "Every first request starts within 90 simulated seconds despite first 21 timeouts");
  remove.forEach(cleanup => cleanup());
  timeouts.splice(0).forEach(timeout => timeout());
  await flush();
  clock += pingCacheIdleMs + 1;
  fair.setVisible(false);

  const ordered: number[] = [];
  const resolvers: ((data: PingResponse) => void)[] = [];
  const due = new PingCache(index => { ordered.push(index); return new Promise(resolve => resolvers.push(resolve)); }, () => clock, 1);
  const cancelEarly = due.subscribe(0, "1h", () => {});
  const cancelLate = due.subscribe(1, "1h", () => {});
  await flush();
  resolvers.shift()!({ ...body, bucket_sec: 300 });
  await flush();
  resolvers.shift()!({ ...body, bucket_sec: 60 });
  await flush();
  due.setVisible(false);
  clock += 300001;
  due.setVisible(true);
  await flush();
  check(ordered[2] === 1, "Earlier retry deadline precedes Map insertion order");
  cancelEarly(); cancelLate();
  resolvers.splice(0).forEach(resolve => resolve(body));
  await flush();
  clock += pingCacheIdleMs + 1;
  due.setVisible(false);

  const identityA = pingNodeIdentity({ name: "A", online: true, region_country: "US" });
  const identityB = pingNodeIdentity({ name: "B", online: true, region_country: "JP" });
  check(identityA === pingNodeIdentity({ name: "A", online: false, region_country: "US", cpu_pct: 80 }), "Telemetry changes must not change identity");
  const signals: AbortSignal[] = [];
  const late: ((data: PingResponse) => void)[] = [];
  const reordered = new PingCache((_index, _range, signal) => {
    signals.push(signal);
    return new Promise(resolve => late.push(resolve));
  }, () => clock);
  const cancelA = reordered.subscribe(0, "1h", () => {}, identityA);
  await flush();
  cancelA();
  check(signals[0].aborted, "Last unsubscribe aborts in-flight request");
  const cancelB = reordered.subscribe(0, "1h", () => {}, identityB);
  await flush();
  late.shift()!(body);
  await flush();
  check(!reordered.snapshot(0, "1h", identityA).data && !reordered.snapshot(0, "1h", identityB).data, "Aborted old node result cannot enter either cache");
  const responseB = { ...body, generated_at: 72000 };
  late.shift()!(responseB);
  await flush();
  check(reordered.snapshot(0, "1h", identityB).data === responseB, "New occupant of index gets own response");
  check(reordered.snapshot(1, "1h", identityB) === emptyPingSnapshot, "Moved node must request the new API index");
  cancelB();
  clock += pingCacheIdleMs + 1;
  reordered.setVisible(false);
  check(reordered.snapshot(0, "1h", identityB) === emptyPingSnapshot, "Expired identity entries must not survive collection");

  const hidden = new PingCache((_index, _range, signal) => { signals.push(signal); return new Promise(resolve => late.push(resolve)); }, () => clock);
  const cancelHidden = hidden.subscribe(0, "1h", () => {});
  await flush();
  hidden.setVisible(false);
  check(signals.at(-1)!.aborted, "Hidden page aborts ongoing request");
  late.shift()!(body);
  await flush();
  check(!hidden.snapshot(0, "1h").data, "Hidden request completion must not populate cache");
  hidden.setVisible(true);
  await flush();
  check(!signals.at(-1)!.aborted, "Resuming starts a fresh request");
  cancelHidden();
  late.shift()!(body);
  await flush();
  clock += pingCacheIdleMs + 1;
  hidden.setVisible(false);

  let notified = false;
  const cancelCompact = subscribePingHistory(999, "1h", "compact", () => { notified = true; }, false);
  await flush();
  cancelCompact();
  check(!notified && pingCache.snapshot(999, "1h", "compact") === emptyPingSnapshot, "Disabled compact view must not subscribe, fetch or access document");
}
void run().catch(error => { setTimeout(() => { throw error; }, 0); });
