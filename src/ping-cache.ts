import { fetchPingHistory, type PingResponse } from "./emerald-ping";
import { requestRange, type DetailRange } from "./emerald-model";
import type { ProbeServer } from "./types";

export type PingSnapshot = { data?: PingResponse; loading: boolean; error?: string };
type Entry = {
  index: number; range: DetailRange; state: PingSnapshot; listeners: Set<() => void>;
  next: number; attempted: boolean; controller?: AbortController; unusedAt?: number;
};
export const emptyPingSnapshot: PingSnapshot = { loading: true };
export const pingRefreshInterval = (seconds?: number) => Math.max(60000, Number.isFinite(seconds) && seconds! > 0 ? seconds! * 1000 : 60000);
export const pingCacheIdleMs = 5 * 60 * 1000;
export const pingNodeIdentity = (server: ProbeServer) => JSON.stringify([
  server.name, server.region, server.region_country, server.region_name, server.region_city,
  server.os, server.arch, server.cpu_model,
]);

export class PingCache {
  private entries = new Map<string, Entry>();
  private active = 0;
  private visible = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private fetcher = fetchPingHistory, private now = Date.now, private concurrency = 3) {}

  private key(index: number, range: DetailRange, identity: string) {
    return JSON.stringify([index, requestRange(range), identity]);
  }
  snapshot(index: number, range: DetailRange, identity = "") {
    return this.entries.get(this.key(index, range, identity))?.state ?? emptyPingSnapshot;
  }
  subscribe(index: number, range: DetailRange, listener: () => void, identity = "") {
    this.collect();
    const key = this.key(index, range, identity);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { index, range, state: emptyPingSnapshot, listeners: new Set(), next: 0, attempted: false };
      this.entries.set(key, entry);
    }
    const subscribed = entry;
    subscribed.unusedAt = undefined;
    subscribed.listeners.add(listener);
    this.pump();
    return () => {
      subscribed.listeners.delete(listener);
      if (!subscribed.listeners.size) {
        subscribed.unusedAt = this.now();
        subscribed.controller?.abort();
      }
      this.pump();
    };
  }
  setVisible(visible: boolean) {
    this.visible = visible;
    if (!visible) for (const entry of this.entries.values()) entry.controller?.abort();
    this.pump();
  }
  private notify(entry: Entry) { entry.listeners.forEach(listener => listener()); }
  private collect() {
    for (const [key, entry] of this.entries) {
      if (!entry.listeners.size && !entry.controller && entry.unusedAt !== undefined && this.now() - entry.unusedAt >= pingCacheIdleMs) this.entries.delete(key);
    }
  }
  private pump() {
    clearTimeout(this.timer);
    this.collect();
    if (this.visible) {
      const due = [...this.entries.values()]
        .filter(entry => entry.listeners.size && !entry.controller && entry.next <= this.now())
        .sort((left, right) => Number(left.attempted) - Number(right.attempted) || left.next - right.next);
      for (const entry of due) {
        if (this.active >= this.concurrency) break;
        const controller = new AbortController();
        entry.controller = controller;
        this.active++;
        entry.state = { ...entry.state, loading: !entry.state.data, error: undefined };
        this.notify(entry);
        void Promise.resolve().then(() => {
          if (controller.signal.aborted) throw new DOMException("Request aborted", "AbortError");
          entry.attempted = true;
          return this.fetcher(entry.index, entry.range, controller.signal);
        }).then(data => {
          if (controller.signal.aborted) return;
          entry.state = { data, loading: false };
          entry.next = this.now() + pingRefreshInterval(data.bucket_sec);
        }).catch(() => {
          if (controller.signal.aborted) return;
          entry.state = { loading: false, error: "加载失败" };
          entry.next = this.now() + 60000;
        }).finally(() => {
          entry.controller = undefined;
          this.active--;
          this.notify(entry);
          this.pump();
        });
      }
    }
    const deadlines = [...this.entries.values()].flatMap(entry => {
      if (!entry.listeners.size && !entry.controller && entry.unusedAt !== undefined) return [entry.unusedAt + pingCacheIdleMs];
      if (this.visible && this.active < this.concurrency && entry.listeners.size && !entry.controller) return [entry.next];
      return [];
    });
    const next = Math.min(...deadlines);
    if (Number.isFinite(next)) this.timer = setTimeout(() => this.pump(), Math.max(1, next - this.now()));
  }
}

export const pingCache = new PingCache();
