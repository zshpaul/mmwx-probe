import { useCallback, useSyncExternalStore } from "react";
import { emptyPingSnapshot, pingCache } from "./ping-cache";
import type { DetailRange } from "./emerald-model";

let subscribers = 0;
const visibility = () => pingCache.setVisible(document.visibilityState === "visible");
export function usePingHistory(index: number, range: DetailRange = "1h") {
  const subscribe = useCallback((listener: () => void) => {
    if (subscribers++ === 0) {
      visibility();
      document.addEventListener("visibilitychange", visibility);
    }
    const unsubscribe = pingCache.subscribe(index, range, listener);
    return () => {
      unsubscribe();
      if (--subscribers === 0) document.removeEventListener("visibilitychange", visibility);
    };
  }, [index, range]);
  const snapshot = useCallback(() => pingCache.snapshot(index, range), [index, range]);
  return useSyncExternalStore(subscribe, snapshot, () => emptyPingSnapshot);
}
