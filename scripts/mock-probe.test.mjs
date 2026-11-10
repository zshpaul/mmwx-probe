import assert from "node:assert/strict";
import { series } from "./mock-probe.mjs";

for (const range of ["1h", "6h", "12h", "24h"]) {
  for (const parameter of ["", "&all=0", "&all=true"]) {
    const response = series(new URL(`http://localhost/api/series?server=0&range=${range}${parameter}`));
    assert.equal(Object.hasOwn(response, "all_series"), false);
    assert.ok(Array.isArray(response.series.buckets));
  }
  const response = series(new URL(`http://localhost/api/series?server=0&range=${range}&all=1`));
  assert.equal(response.all_series.length, 3);
  assert.equal(Object.hasOwn(response, "buckets"), false);
  assert.equal(response.all_series[0].buckets.length, response.series.buckets.length);
  assert.equal(response.all_series[0].isp, "telecom");
  if (range === "1h") assert.equal(response.series.buckets.length, 12);
  if (range === "24h") assert.equal(response.series.buckets.length, 48);
  const system = series(new URL(`http://localhost/api/series?server=0&range=${range}&metric=system&all=1`));
  assert.equal(Object.hasOwn(system, "all_series"), false);
  assert.ok(Array.isArray(system.series.cpu_pct));
}
