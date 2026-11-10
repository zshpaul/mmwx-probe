import { renderToStaticMarkup } from "react-dom/server";
import { financeSummary, nodeLocation, priceCards } from "./emerald-model";
import { ServerCard } from "./App";
import { ServerList } from "./ServerList";
import { ServerDetails } from "./ServerDetails";
import type { ProbeServer } from "./types";

function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${expected}, received ${actual}`);
}
equal(nodeLocation({ online: true, region_city: "Los Angeles", region_name: "California", region: "US" }), "洛杉矶");
equal(nodeLocation({ online: true, region_city: "San Jose" }), "圣何塞");
equal(nodeLocation({ online: true, region_city: "Osaka" }), "大阪");
equal(nodeLocation({ online: true, region_city: " ", region_name: "Osaka", region: "JP" }), "大阪");
equal(nodeLocation({ online: true, region_city: "", region_name: "", region: "Custom region" }), "Custom region");
equal(nodeLocation({ online: true, region_country: "US" }), "");
equal(nodeLocation({ online: true, region_city: "Unknown City" }), "Unknown City");
equal(nodeLocation({ online: true, region_city: "广州" }), "广州");
equal(nodeLocation({ online: true, region_city: " osaka " }), "大阪");
equal(nodeLocation({ online: true }), "");
equal(nodeLocation({ online: true, region_city: "Unknown", region_name: "未知", region: "—" }), "");
const server = { online: true, name: "Example", region_city: "San Jose", cpu_pct: 5, loadavg: "1.64 1.39 1.20 4/278 41234" };
const card = renderToStaticMarkup(<ServerCard server={server} index={0} now={0} onPing={() => {}} />);
equal(card.includes('class="node-city" title="圣何塞">圣何塞</span>'), true);
equal(card.includes('class="resource-quantity">1.64, 1.39, 1.20</p>'), true);
equal(card.includes('title="1.64 1.39 1.20 4/278 41234"'), true);
const list = renderToStaticMarkup(<ServerList nodes={[{ server, index: 0 }]} onPing={() => {}} />);
equal(list.includes('class="node-city" title="圣何塞">圣何塞</span>'), true);
equal(list.includes("1.64, 1.39, 1.20\n1.64 1.39 1.20 4/278 41234"), true);
const empty = renderToStaticMarkup(<ServerCard server={{ online: true }} index={0} now={0} onPing={() => {}} />);
equal(empty.includes('class="node-city"'), false);
for (const pricing of [{ renewal_price: 0, renewal_currency: "USD" }, { renewal_price: 0 }, { renewal_price_cny: 0 }]) {
  const free: ProbeServer = { online: true, ...pricing, renewal_cycle: "year", expires_at: "2026-11-20T00:00:00Z" };
  const cards = priceCards(free, Date.parse("2026-11-10T00:00:00Z"));
  equal(cards.find(card => card.label === "节点价格")?.value, "免费");
  equal(cards.find(card => card.label === "节点价格")?.unit, undefined);
  equal(cards.some(card => ["月均支出", "剩余价值"].includes(card.label)), false);
  equal(cards.find(card => card.label === "剩余时间")?.value, "10");
  equal(financeSummary([free], 0)[0].total, 0);
  equal(financeSummary([free], 0)[0].monthly, 0);
  const freeCard = renderToStaticMarkup(<ServerCard server={free} index={0} now={0} onPing={() => {}} />);
  const freeDetail = renderToStaticMarkup(<ServerDetails server={free} index={0} updatedAt={0} />);
  equal(freeCard.includes("免费"), true);
  equal(freeDetail.includes("<strong>免费</strong>"), true);
  equal(freeCard.includes("undefined") || freeDetail.includes("undefined"), false);
}
equal(priceCards({ online: true, renewal_cycle: "permanent" }, 0).some(card => card.label === "节点价格"), false);
equal(priceCards({ online: true }, 0).length, 0);
equal(priceCards({ online: true, renewal_price: 0, renewal_cycle: "permanent" }, 0).length, 1);
