import { maskVisitorIp, visitorResponse } from "../worker/visitor";
import worker from "../worker/index";
import { visitorBrowser, visitorLocation } from "./visitor-model";

function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}
for (const [input, expected] of [
  ["207.57.123.91", "207.57.***.91"],
  ["192.0.2.1", "192.0.*.1"],
  ["2001:db8:1234:5678:abcd:ef01:2345:6789", "2001:db8:1234:5678:*"],
  ["2001:db8::1", "2001:db8:0:0:*"],
  ["::1", "0:0:0:0:*"],
  ["::ffff:192.0.2.1", "0:0:0:0:*"],
  ["", ""], ["256.1.2.3", ""], ["1.2.3", ""], ["01.2.3.4", ""],
  ["2001:::1", ""], ["[::1]", ""], ["fe80::1%eth0", ""], ["bad", ""],
]) check(maskVisitorIp(input) === expected, `Mask failed for fixture ${input}`);
check(maskVisitorIp(null) === "" && maskVisitorIp(undefined) === "", "Missing IP must be empty");
check(visitorBrowser("Mozilla Chrome/130 Safari/537 Edg/130") === "Edge", "Edge before Chrome");
check(visitorBrowser("Mozilla Safari/605") === "Safari", "Safari");
check(visitorBrowser("") === "未知浏览器", "Unknown UA");
check(visitorLocation() === "网络访客", "Missing location fallback");
check(visitorLocation({ countryCode: "US", city: "Los Angeles", region: "", maskedIp: "" }) === "United States · Los Angeles", "Country name and city");

async function verify() {
  const request = new Request("https://probe.example/api/visitor", { headers: { "CF-Connecting-IP": "207.57.123.91" } });
  Object.defineProperty(request, "cf", { value: { country: "US", city: "Los Angeles", region: "California", latitude: "ignored" } });
  const response = visitorResponse(request);
  const body = await response.text();
  check(body === JSON.stringify({ countryCode: "US", city: "Los Angeles", region: "California", maskedIp: "207.57.***.91" }), "Only allowlisted visitor fields");
  check(!body.includes(request.headers.get("CF-Connecting-IP")!), "Raw IP must not leave Worker");
  check(response.headers.get("Cache-Control") === "private, no-store", "Private noncached response");
  const missing = await visitorResponse(new Request("https://probe.example/api/visitor")).json();
  check(JSON.stringify(missing) === JSON.stringify({ countryCode: "", city: "", region: "", maskedIp: "" }), "No invented missing fields");
  const partial = new Request("https://probe.example/api/visitor");
  Object.defineProperty(partial, "cf", { value: { country: "XX", city: null, region: 42 } });
  check(JSON.stringify(await visitorResponse(partial).json()) === JSON.stringify(missing), "Invalid metadata becomes empty");
  const result = await worker.fetch(request, { ASSETS: { fetch: () => { throw new Error("Must not reach assets"); } } as unknown as Fetcher, MMWX_ORIGIN: "", PROBE_TOKEN: "" });
  check(result.ok, "Visitor route independent of proxy origin and secret");
  const post = visitorResponse(new Request("https://probe.example/api/visitor", { method: "POST" }));
  check(post.status === 405 && post.headers.get("Cache-Control") === "private, no-store", "GET only including noncacheable errors");
}
void verify().catch(error => { setTimeout(() => { throw error; }, 0); });
