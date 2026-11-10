export interface VisitorData {
  countryCode: string;
  city: string;
  region: string;
  maskedIp: string;
}

export function visitorBrowser(userAgent: string): string {
  if (/Edg(?:e|A|iOS)?\//i.test(userAgent)) return "Edge";
  if (/OPR\/|Opera/i.test(userAgent)) return "Opera";
  if (/Firefox\/|FxiOS\//i.test(userAgent)) return "Firefox";
  if (/Chrome\/|CriOS\//i.test(userAgent)) return "Chrome";
  if (/Safari\//i.test(userAgent)) return "Safari";
  return "未知浏览器";
}

export function visitorLocation(visitor?: VisitorData): string {
  if (!visitor) return "网络访客";
  let country = "";
  if (/^[A-Z]{2}$/.test(visitor.countryCode)) {
    country = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" }).of(visitor.countryCode) || "";
  }
  return [country, visitor.city || visitor.region].filter(Boolean).join(" · ") || "网络访客";
}
