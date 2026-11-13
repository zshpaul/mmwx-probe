import { useEffect, useState } from "react";
import { bwhUsGroupId } from "./client-latency-prices";

export type ClientQuota = {
  version: 1; group_id: string; revision: number; updated_at: string;
  upload_bytes: number | null; download_bytes: number | null; total_bytes: number | null; expires_at: string | null;
};
export function useClientQuota(): ClientQuota | undefined {
  const [quota, setQuota] = useState<ClientQuota>();
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/client-quota/v1/snapshot?group_id=${encodeURIComponent(bwhUsGroupId)}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const value = await response.json() as { version: number; snapshot: ClientQuota | null };
        if (active && value.version === 1) setQuota(value.snapshot ?? undefined);
      } catch { /* Keep last snapshot while temporarily offline. */ }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, []);
  return quota;
}
export function quotaUsage(quota?: ClientQuota) {
  const up = quota?.upload_bytes, down = quota?.download_bytes, total = quota?.total_bytes;
  const sum = up != null && down != null ? up + down : undefined;
  const used = sum !== undefined && Number.isSafeInteger(sum) ? sum : undefined;
  return { used, total: total ?? undefined, remaining: used !== undefined && total != null ? Math.max(0, total - used) : undefined };
}
