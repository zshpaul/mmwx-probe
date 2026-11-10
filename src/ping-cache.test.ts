import { PingCache, pingRefreshInterval } from "./ping-cache";
import type { PingResponse } from "./emerald-ping";

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
  const failed = new PingCache(() => { throw new Error("Synchronous network failure"); });
  const stop = failed.subscribe(0, "1h", () => {});
  await flush();
  check(failed.snapshot(0, "1h").error === "加载失败" && !failed.snapshot(0, "1h").data, "Catch synchronous failure without stale bars");
  stop();
  check(pingRefreshInterval(30) === 60000 && pingRefreshInterval(300) === 300000 && pingRefreshInterval(undefined) === 60000, "Refresh interval must respect buckets and minimum");
}
void run().catch(error => { setTimeout(() => { throw error; }, 0); });
