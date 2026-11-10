import { fetchPingHistory, type PingResponse } from "./emerald-ping";
import { requestRange, type DetailRange } from "./emerald-model";

export type PingSnapshot = { data?: PingResponse; loading: boolean; error?: string };
type Entry = { index: number; range: DetailRange; state: PingSnapshot; listeners: Set<() => void>; next: number; pending: boolean };
export const emptyPingSnapshot: PingSnapshot = { loading: true };
export const pingRefreshInterval = (seconds?: number) => Math.max(60000, Number.isFinite(seconds) && seconds! > 0 ? seconds! * 1000 : 60000);

export class PingCache {
  private entries = new Map<string, Entry>();
  private active = 0;
  private visible = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private fetcher = fetchPingHistory, private now = Date.now, private concurrency = 3) {}

  private entry(index: number, range: DetailRange) {
    const key = `${index}:${requestRange(range)}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { index, range, state: emptyPingSnapshot, listeners: new Set(), next: 0, pending: false };
      this.entries.set(key, entry);
    }
    return entry;
  }
  snapshot(index: number, range: DetailRange) { return this.entry(index, range).state; }
  subscribe(index: number, range: DetailRange, listener: () => void) {
    const entry = this.entry(index, range);
    entry.listeners.add(listener);
    this.pump();
    return () => { entry.listeners.delete(listener); this.pump(); };
  }
  setVisible(visible: boolean) { this.visible = visible; this.pump(); }
  private notify(entry: Entry) { entry.listeners.forEach(listener => listener()); }
  private pump() {
    clearTimeout(this.timer);
    if (!this.visible) return;
    for (const entry of this.entries.values()) {
      if (this.active >= this.concurrency) break;
      if (!entry.listeners.size || entry.pending || entry.next > this.now()) continue;
      entry.pending = true;
      this.active++;
      entry.state = { ...entry.state, loading: !entry.state.data, error: undefined };
      this.notify(entry);
      void Promise.resolve().then(() => this.fetcher(entry.index, entry.range, new AbortController().signal)).then(data => {
        entry.state = { data, loading: false };
        entry.next = this.now() + pingRefreshInterval(data.bucket_sec);
      }).catch(() => {
        entry.state = { loading: false, error: "加载失败" };
        entry.next = this.now() + 60000;
      }).finally(() => {
        entry.pending = false;
        this.active--;
        this.notify(entry);
        this.pump();
      });
    }
    const next = Math.min(...[...this.entries.values()].filter(entry => entry.listeners.size && !entry.pending).map(entry => entry.next));
    if (Number.isFinite(next) && this.active < this.concurrency) this.timer = setTimeout(() => this.pump(), Math.max(1, next - this.now()));
  }
}

export const pingCache = new PingCache();
