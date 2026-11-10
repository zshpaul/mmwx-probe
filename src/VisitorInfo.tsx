import { useEffect, useState } from "react";
import { Globe2, Monitor, Network } from "lucide-react";
import { visitorBrowser, visitorLocation, type VisitorData } from "./visitor-model";

export function VisitorInfo({ onVisitor }: { onVisitor: (visitor: VisitorData) => void }) {
  const [visitor, setVisitor] = useState<VisitorData>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void fetch("/api/visitor", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) })
      .then(async response => {
        if (!response.ok) throw new Error("Visitor unavailable");
        const payload = await response.json() as Record<string, unknown>;
        const value: VisitorData = {
          countryCode: typeof payload.countryCode === "string" && /^[A-Z]{2}$/.test(payload.countryCode) ? payload.countryCode : "",
          city: typeof payload.city === "string" ? payload.city : "",
          region: typeof payload.region === "string" ? payload.region : "",
          maskedIp: typeof payload.maskedIp === "string" && payload.maskedIp.includes("*") ? payload.maskedIp : "",
        };
        if (active) { setVisitor(value); onVisitor(value); }
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [onVisitor]);
  return <aside className="visitor-info" aria-label="访客信息">
    <span><Globe2 size={13} /><span className="visitor-location">{loading ? "正在定位访客来源" : visitorLocation(visitor)}</span></span>
    <span><Network size={13} />{loading ? "获取中" : visitor?.maskedIp || "暂无法获取"}</span>
    <span><Monitor size={13} />{visitorBrowser(navigator.userAgent)}</span>
  </aside>;
}
