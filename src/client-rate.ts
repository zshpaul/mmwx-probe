import { useEffect, useState } from "react";
import { bwhUsGroupId } from "./client-latency-prices";

export type ClientRate = { observed_at: string; upload_bps: number; download_bps: number };
export function useClientRate(): ClientRate | undefined {
  const [rate, setRate] = useState<ClientRate>();
  useEffect(() => {
    let active = true;
    let sequence = 0;
    const controller = new AbortController();
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const requestNumber = ++sequence;
      const started = performance.now();
      try {
        const response = await fetch(`/api/client-rate/v1/snapshot?group_id=${encodeURIComponent(bwhUsGroupId)}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const value = await response.json() as {
          version: number; expires_in_ms: number;
          snapshot: { group_id: string; observed_at: string; status: string; upload_bps: number | null; download_bps: number | null } | null;
        };
        if (!active || requestNumber !== sequence) return;
        const remaining = Math.max(0, Math.min(30_000, value.expires_in_ms) - (performance.now() - started));
        const sample = value.snapshot;
        if (value.version !== 1 || !Number.isFinite(remaining) || remaining <= 0 || sample?.group_id !== bwhUsGroupId ||
            sample.status !== "ok" || !Number.isSafeInteger(sample.upload_bps) || !Number.isSafeInteger(sample.download_bps) ||
            sample.upload_bps! < 0 || sample.download_bps! < 0) {
          if (expiry) clearTimeout(expiry);
          setRate(undefined); return;
        }
        if (expiry) clearTimeout(expiry);
        setRate({ observed_at: sample.observed_at, upload_bps: sample.upload_bps!, download_bps: sample.download_bps! });
        expiry = setTimeout(() => setRate(undefined), remaining);
      } catch { /* The existing timeout still expires the previous value. */ }
    };
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => { active = false; controller.abort(); clearInterval(timer); if (expiry) clearTimeout(expiry); };
  }, []);
  return rate;
}
