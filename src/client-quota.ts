import { useEffect, useState } from "react";
import { bwhUsGroupId } from "./client-latency-prices";

export type ClientQuota = {
  version: 1; group_id: string; revision: number; updated_at: string;
  upload_bytes: number | null; download_bytes: number | null; total_bytes: number | null; expires_at: string | null;
};
export function useClientQuota(groupId = bwhUsGroupId): ClientQuota | undefined {
  const [quota, setQuota] = useState<ClientQuota>();
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/client-quota/v1/snapshot?group_id=${encodeURIComponent(groupId)}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const value = await response.json() as { version: number; snapshot: ClientQuota | null };
        if (active && value.version === 1 && (!value.snapshot || value.snapshot.group_id === groupId)) setQuota(value.snapshot ?? undefined);
      } catch { /* Keep last snapshot while temporarily offline. */ }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [groupId]);
  return quota;
}
export type QuotaMode = "both" | "download";
export function quotaUsage(quota?: ClientQuota, mode: QuotaMode = "both") {
  const up = quota?.upload_bytes, down = quota?.download_bytes, total = quota?.total_bytes;
  const sum = up != null && down != null ? up + down : undefined;
  const selected = mode === "download" ? down : sum;
  const used = selected != null && Number.isSafeInteger(selected) ? selected : undefined;
  return { used, total: total ?? undefined, remaining: used !== undefined && total != null ? Math.max(0, total - used) : undefined };
}
