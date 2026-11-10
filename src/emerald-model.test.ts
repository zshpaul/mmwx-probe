import { bytes, historyRows, priceCards, ratio, requestRange } from "./emerald-model";

const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${expected}, received ${actual}`);
  },
  deepEqual(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  },
};
const now = Date.parse("2026-11-10T00:00:00Z");
assert.deepEqual(priceCards({ online: true }, now), []);
assert.equal(priceCards({ online: true, renewal_price: 5 }, now).length, 0);
assert.equal(ratio(0, 0), undefined);
assert.equal(ratio(200, 100), 100);
assert.equal(bytes(1024), "1 KB");
assert.equal(bytes(1024 ** 2), "1.0 MB");
assert.equal(bytes(1000 * 1024 ** 3), "1000.0 GB");
const prices = priceCards({ online: true, renewal_price_cny: 365, renewal_cycle: "year", expires_at: "2026-11-20T00:00:00Z" }, now);
assert.deepEqual(prices.map(card => card.value), ["¥365.00", "¥30.00", "10", "¥10.00"]);
assert.equal(priceCards({ online: true, renewal_price_cny: 0, renewal_cycle: "month" }, now)[0].value, "¥0.00");
assert.equal(priceCards({ online: true, renewal_price_cny: 10, renewal_cycle: "permanent" }, now).length, 2);
assert.equal(priceCards({ online: true, expires_at: "invalid" }, now).length, 0);
assert.equal(priceCards({ online: true, expires_at: "2026-01-01" }, now)[0].value, "已到期");
assert.equal(requestRange("12h"), "24h");
const end = 172800;
const rows = historyRows({ generated_at: end, bucket_sec: 1800, buckets: 48, series: {
  cpu_pct: [{ t: end, value: 0 }],
  mem_used: [{ t: end, value: 1.5 * 1024 ** 3 }],
  upload_speed: [{ t: end, value: 3 * 1024 ** 2 }],
  tcp_connections: [{ t: end, value: 0 }],
  disk_used: [{ t: end, value: NaN }],
} }, "12h");
assert.equal(rows.length, 24);
assert.equal(rows[0].time, end - 23 * 1800);
assert.equal(rows.at(-1)?.cpu, 0);
assert.equal(rows.at(-1)?.mem_used, 1.5);
assert.equal(rows.at(-1)?.upload_speed, 3);
assert.equal(rows.at(-1)?.tcp_connections, 0);
assert.equal(rows.at(-1)?.disk_used, null);
assert.equal(rows.at(-2)?.cpu, null);
assert.equal(rows.at(-2)?.mem_used, null);
