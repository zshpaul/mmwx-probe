import { fetchPingHistory } from "./emerald-ping";

function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function verify() {
  const originalFetch = globalThis.fetch;
  const target = { label: "电信", buckets: [{ ms: 42, loss: 0 }], current_ms: 42, loss_pct: 0 };
  try {
    globalThis.fetch = (async (input, options) => {
      const url = new URL(String(input), "https://probe.example");
      check(url.pathname === "/api/series", "History endpoint");
      check(url.searchParams.get("all") === "1", "All-target history must explicitly request all=1");
      check(url.searchParams.get("server") === "2", "Selected server must be retained");
      check(options?.cache === "no-store" && !!options.signal, "History must keep cancellation and no-store");
      return Response.json({ success: true, series: target, ...(url.searchParams.get("all") === "1" ? { all_series: [target] } : {}) });
    }) as typeof fetch;
    for (const range of ["1h", "6h", "12h", "24h"] as const) {
      const result = await fetchPingHistory(2, range, new AbortController().signal);
      check(result.all_series?.length === 1 && result.all_series[0].label === "电信", "Prefer target series without duplicating aggregate");
    }
    globalThis.fetch = (async () => Response.json({ success: true, series: target })) as typeof fetch;
    const aggregate = await fetchPingHistory(2, "1h", new AbortController().signal);
    check(aggregate.all_series?.[0].key === "__avg__" && aggregate.all_series[0].buckets[0].ms === 42, "Support main's aggregate-only response without fabricating data");
    globalThis.fetch = (async () => Response.json({ success: true, all_series: [] })) as typeof fetch;
    check((await fetchPingHistory(2, "1h", new AbortController().signal)).all_series?.length === 0, "Empty history is valid");
    for (const invalid of [null, {}, { success: false }, { all_series: [null] }, { all_series: [{ buckets: [{}] }] }]) {
      globalThis.fetch = (async () => Response.json(invalid)) as typeof fetch;
      let failed = false;
      try { await fetchPingHistory(2, "1h", new AbortController().signal); } catch { failed = true; }
      check(failed, "Malformed history must still reject");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}
void verify().catch(error => { setTimeout(() => { throw error; }, 0); });
