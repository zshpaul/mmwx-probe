import { useCallback, useSyncExternalStore } from "react";
import { emptyPingSnapshot, pingCache, pingNodeIdentity } from "./ping-cache";
import type { DetailRange } from "./emerald-model";
import type { ProbeServer } from "./types";

let subscribers = 0;
const visibility = () => pingCache.setVisible(document.visibilityState === "visible");
export function subscribePingHistory(index: number, range: DetailRange, identity: string, listener: () => void, enabled: boolean) {
  if (!enabled) return () => {};
  if (subscribers++ === 0) {
    visibility();
    document.addEventListener("visibilitychange", visibility);
  }
  const unsubscribe = pingCache.subscribe(index, range, listener, identity);
  return () => {
    unsubscribe();
    if (--subscribers === 0) document.removeEventListener("visibilitychange", visibility);
  };
}
export function usePingHistory(index: number, server: ProbeServer, range: DetailRange = "1h", enabled = true) {
  const identity = pingNodeIdentity(server);
  const subscribe = useCallback((listener: () => void) => subscribePingHistory(index, range, identity, listener, enabled), [index, range, identity, enabled]);
  const snapshot = useCallback(() => enabled ? pingCache.snapshot(index, range, identity) : emptyPingSnapshot, [index, range, identity, enabled]);
  return useSyncExternalStore(subscribe, snapshot, () => emptyPingSnapshot);
}
