const assert = {
  equal(actual: unknown, expected: unknown) { if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`); },
  deepEqual(actual: unknown, expected: unknown) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Values differ"); },
  ok(value: unknown) { if (!value) throw new Error("Assertion failed"); },
};
import { renderToStaticMarkup } from "react-dom/server";
import { bwhUsGroupId, clientGroupCalendarDays, clientGroupFinanceAssets, clientGroupPrice, dmitUsGroupId } from "./client-latency-prices";
import { financeSummary } from "./emerald-model";
import { FleetSummary, fleetFinance } from "./FleetSummary";
import type { ProbeServer } from "./types";

const now = Date.parse("2027-11-09T16:00:00Z"); // November 10 in Hong Kong
const assets = clientGroupFinanceAssets();
assert.equal(assets.length, 2);
assert.deepEqual(assets, [bwhUsGroupId, dmitUsGroupId].map(id => clientGroupPrice(id, false)));
const cny = financeSummary(assets, now, true)[0];
assert.equal(cny.currency, "CNY");
assert.equal(cny.total, 200);
assert.equal(cny.monthly, 200 * 30 / 365);
assert.equal(cny.remaining, 80 / 365 + 120 * 11 / 365);
assert.equal(cny.estimated, 2);
assert.equal(clientGroupCalendarDays("2027-11-21", Date.parse("2027-11-20T15:59:59Z")), 1);
assert.equal(clientGroupCalendarDays("2027-11-21", Date.parse("2027-11-20T16:00:00Z")), 0);
assert.equal(clientGroupCalendarDays("2027-11-21", Date.parse("2027-11-21T16:00:00Z")), -1);
assert.equal(clientGroupCalendarDays("2027-02-30", now), undefined);
assert.equal(financeSummary([assets[0]], Date.parse("2027-11-10T15:59:59Z"))[0].remaining > 0, true);
assert.equal(financeSummary([assets[0]], Date.parse("2027-11-10T16:00:00Z"))[0].remaining, 0);
assert.equal(financeSummary([assets[1]], Date.parse("2027-11-20T16:00:00Z"), true)[0].remaining, 0);
assert.equal(financeSummary([assets[1]], Date.parse("2027-11-21T16:00:00Z"), true)[0].remaining, 0);
const server: ProbeServer = { online: false, renewal_price: 365, renewal_currency: "USD", renewal_cycle: "year", expires_at: "2027-11-11T16:00:00Z" };
const mixed = financeSummary([server, ...assets], now, true);
assert.equal(mixed.find(x => x.currency === "USD")?.remaining, 2);
assert.equal(mixed.find(x => x.currency === "CNY")?.remaining, cny.remaining);
for (const bad of [
  { renewal_price_cny: undefined }, { renewal_price_cny: -1 }, { renewal_price_cny: NaN },
  { renewal_cycle: "permanent" as const }, { renewal_cycle: undefined },
  { expiry_date: "2027-02-30", expires_at: undefined }, { expiry_date: undefined, expires_at: "invalid" },
]) {
  const item = { ...assets[1], ...bad };
  const result = financeSummary([item], now, true);
  assert.equal(result.reduce((sum, group) => sum + group.remaining, 0), 0);
  assert.equal(result.reduce((sum, group) => sum + group.estimated, 0), 0);
}
const free = financeSummary([{ ...assets[1], renewal_price_cny: 0 }], now, true)[0];
assert.equal(free.remaining, 0);
const markup = renderToStaticMarkup(<FleetSummary servers={[server]} now={now} formatBytes={String} />);
assert.ok(markup.includes(`¥${cny.remaining.toFixed(2)}`));
assert.ok(markup.includes(`<dt>总价值</dt><dd>—</dd>`));
assert.ok(markup.includes(`<dt>月均支出</dt><dd>—</dd>`));
assert.ok(markup.includes(`<dt>剩余价值</dt><dd>${cny.remaining.toFixed(2)}</dd>`));
assert.ok(markup.includes(`<h3>USD</h3>`));

const cnyServer: ProbeServer = { online: true, renewal_price_cny: 365, renewal_cycle: "year", expires_at: "2027-11-11T16:00:00Z" };
const combinedMarkup = renderToStaticMarkup(<FleetSummary servers={[cnyServer]} now={now} formatBytes={String} />);
assert.ok(combinedMarkup.includes(`<dt>总价值</dt><dd>365.00</dd>`));
assert.ok(combinedMarkup.includes(`<dt>月均支出</dt><dd>30.00</dd>`));
assert.ok(combinedMarkup.includes(`<dt>剩余价值</dt><dd>${(2 + cny.remaining).toFixed(2)}</dd>`));
assert.ok(combinedMarkup.includes("另有 2 项客户端资产计入剩余价值"));

const foreignClient = { ...assets[0], renewal_price_cny: undefined, renewal_price: 365, renewal_currency: "USD" };
const currencyGroups = fleetFinance([server], [foreignClient], now);
assert.equal(currencyGroups.length, 1);
assert.equal(currencyGroups[0].remaining, 3);
assert.equal(currencyGroups[0].total, 365);
assert.equal(currencyGroups[0].monthly, 30);
assert.equal(currencyGroups[0].clientEstimated, 1);
assert.equal(fleetFinance([], [{ ...foreignClient, renewal_price: 0 }], now).length, 0);
assert.equal(fleetFinance([], [{ ...foreignClient, renewal_currency: undefined }], now).length, 0);

const serverWithExtraDate = { ...server, expiry_date: "invalid" };
assert.equal(fleetFinance([serverWithExtraDate], [], now)[0].remaining, 2);
const usdBeforeCny = fleetFinance([server], assets, now);
assert.equal(usdBeforeCny[0].currency, "USD");
assert.equal(usdBeforeCny.find(group => group.currency === "CNY")?.clientEstimated, 2);
