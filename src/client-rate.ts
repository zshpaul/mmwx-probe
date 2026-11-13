import { useEffect, useState } from "react";
import { bwhUsGroupId } from "./client-latency-prices";

export type ClientRate = { observed_at: string; upload_bps: number; download_bps: number };
export type RatePresence = { state: "online" | "offline" | "unknown"; observedAt?: string };
type RateResponse = {
  version: number; expires_in_ms: number;
  snapshot: { group_id: string; observed_at: string; status: string; upload_bps: number | null; download_bps: number | null } | null;
};
export function readRateSnapshot(value: RateResponse, elapsed: number): { presence: RatePresence; rate?: ClientRate; remaining: number } {
  const sample = value.snapshot;
  if (value.version !== 1 || !Number.isFinite(value.expires_in_ms) || value.expires_in_ms < 0 ||
      (sample !== null && (sample?.group_id !== bwhUsGroupId || !Number.isFinite(Date.parse(sample.observed_at)) ||
      !((sample.status === "ok" && Number.isSafeInteger(sample.upload_bps) && Number.isSafeInteger(sample.download_bps) &&
        sample.upload_bps! >= 0 && sample.download_bps! >= 0) ||
        (sample.status === "unknown" && sample.upload_bps === null && sample.download_bps === null))))) throw new Error("invalid response");
  const remaining = Math.max(0, Math.min(30_000, value.expires_in_ms) - elapsed);
  if (!sample || remaining <= 0) return { presence: { state: sample ? "offline" : "unknown", observedAt: sample?.observed_at }, remaining: 0 };
  return {
    presence: { state: "online", observedAt: sample.observed_at },
    rate: sample.status === "ok" ? { observed_at: sample.observed_at, upload_bps: sample.upload_bps!, download_bps: sample.download_bps! } : undefined,
    remaining,
  };
}
export function useClientRate(): { rate?: ClientRate; presence: RatePresence } {
  const [rate, setRate] = useState<ClientRate>();
  const [presence, setPresence] = useState<RatePresence>({ state: "unknown" });
  useEffect(() => {
    let active = true;
    let sequence = 0;
    let reachable = false;
    const controller = new AbortController();
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const requestNumber = ++sequence;
      const started = performance.now();
      reachable = false;
      try {
        const response = await fetch(`/api/client-rate/v1/snapshot?group_id=${encodeURIComponent(bwhUsGroupId)}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("request failed");
        const value = await response.json() as RateResponse;
        if (!active || requestNumber !== sequence) return;
        const result = readRateSnapshot(value, performance.now() - started);
        reachable = true;
        if (expiry) clearTimeout(expiry);
        setPresence(result.presence);
        setRate(result.rate);
        if (!result.remaining) return;
        expiry = setTimeout(() => {
          setRate(undefined);
          setPresence({ state: reachable ? "offline" : "unknown", observedAt: result.presence.observedAt });
        }, result.remaining);
      } catch {
        if (!active || requestNumber !== sequence) return;
        reachable = false;
        setPresence(previous => previous.state === "online" ? previous : { ...previous, state: "unknown" });
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => { active = false; controller.abort(); clearInterval(timer); if (expiry) clearTimeout(expiry); };
  }, []);
  return { rate, presence };
}
