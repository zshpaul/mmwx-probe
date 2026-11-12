import { renderToStaticMarkup } from "react-dom/server";
import { financeSummary, locationName, nodeLocation, priceCards } from "./emerald-model";
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
for (const city of ["Frankfurt", " frankfurt ", "FRANKFURT AM MAIN", " Frankfurt  am\tMain ", "法兰克福"]) {
  const frankfurt = { online: true, name: "Frankfurt · EU", region_city: city, region_country: "DE" };
  equal(nodeLocation(frankfurt), "法兰克福");
  equal(locationName(frankfurt), "DE · 法兰克福");
  for (const markup of [
    renderToStaticMarkup(<ServerCard server={frankfurt} index={0} now={0} onPing={() => {}} />),
    renderToStaticMarkup(<ServerList nodes={[{ server: frankfurt, index: 0 }]} onPing={() => {}} />),
    renderToStaticMarkup(<ServerDetails server={frankfurt} index={0} updatedAt={0} />),
  ]) {
    equal(markup.includes('class="node-city" title="法兰克福">法兰克福</span>'), true);
    equal(markup.includes("Frankfurt · EU"), true);
    equal(markup.includes('title="DE · 法兰克福"'), true);
  }
}
equal(nodeLocation({ online: true, region_name: " Frankfurt am Main " }), "法兰克福");
equal(nodeLocation({ online: true, region: "FRANKFURT" }), "法兰克福");
equal(nodeLocation({ online: true, region_city: "Frankfurt Airport" }), "Frankfurt Airport");
equal(locationName({ online: true, region_name: "Frankfurt Airport" }), "Frankfurt Airport");
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
for (const pricing of [{}, { renewal_price: null }, { renewal_price_cny: null }, { renewal_price: null, renewal_price_cny: null }]) {
  const free: ProbeServer = JSON.parse(JSON.stringify({ online: true, renewal_cycle: "permanent", ...pricing }));
  const cards = priceCards(free, 0);
  equal(cards.find(card => card.label === "节点价格")?.value, "免费");
  equal(cards.find(card => card.label === "节点价格")?.unit, undefined);
  equal(cards.find(card => card.label === "剩余时间")?.value, "长期");
  equal(cards.some(card => ["月均支出", "剩余价值"].includes(card.label)), false);
  equal(financeSummary([free], 0).length, 0);
  const paid: ProbeServer = { online: true, renewal_price_cny: 30, renewal_cycle: "month" };
  equal(JSON.stringify(financeSummary([paid, free], 0)), JSON.stringify(financeSummary([paid], 0)));
  equal(renderToStaticMarkup(<ServerCard server={free} index={0} now={0} onPing={() => {}} />).includes("免费"), true);
  equal(renderToStaticMarkup(<ServerDetails server={free} index={0} updatedAt={0} />).includes("<strong>免费</strong>"), true);
}
equal(priceCards({ online: true, renewal_cycle: "month" }, 0).length, 0);
equal(priceCards({ online: true, renewal_cycle: "permanent", renewal_price: 5, renewal_currency: "USD" }, 0)[0].value, "$5.00");
equal(priceCards({ online: true, renewal_cycle: "permanent", renewal_price_cny: 10 }, 0)[0].value, "¥10.00");
equal(priceCards({ online: true, renewal_cycle: "permanent", renewal_price: -1 }, 0).some(card => card.value === "免费"), false);
equal(priceCards({ online: true }, 0).length, 0);
equal(priceCards({ online: true, renewal_price: 0, renewal_cycle: "permanent" }, 0).length, 2);
