export function maskVisitorIp(value: string | null | undefined): string {
  if (!value) return "";
  const address = value.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    const segments = address.split(".");
    if (segments.some(segment => Number(segment) > 255 || (segment.length > 1 && segment.startsWith("0")))) return "";
    return `${segments[0]}.${segments[1]}.${"*".repeat(segments[2].length)}.${segments[3]}`;
  }
  if (!address.includes(":") || !/^[\da-f:.]+$/i.test(address)) return "";
  try {
    const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const halves = normalized.split("::");
    const prefix = halves[0] ? halves[0].split(":") : [];
    const suffix = halves.length > 1 && halves[1] ? halves[1].split(":") : [];
    const segments = halves.length > 1
      ? [...prefix, ...Array<string>(8 - prefix.length - suffix.length).fill("0"), ...suffix]
      : prefix;
    if (segments.length !== 8) return "";
    return `${segments.slice(0, 4).join(":")}:*`;
  } catch {
    return "";
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function visitorResponse(request: Request): Response {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: { ...headers, Allow: "GET" } });
  }
  const metadata = request.cf as Record<string, unknown> | undefined;
  const country = text(metadata?.country).toUpperCase();
  const countryCode = /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1" ? country : "";
  return Response.json({
    countryCode,
    city: text(metadata?.city),
    region: text(metadata?.region),
    maskedIp: maskVisitorIp(request.headers.get("CF-Connecting-IP")),
  }, { headers });
}
