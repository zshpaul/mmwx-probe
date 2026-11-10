import { fetchPingHistory, pingHistoryRows, type PingResponse } from "./emerald-ping";

const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${expected}, received ${actual}`);
  },
  deepEqual(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Unexpected history rows");
  },
};

const recordedLatencies = [
  [240, 317, 260, 238, 221, 238, 201, 278, 391, 330, 292, 290],
  [285, 295, 328, 303, 291, 270, 324, 283, 275, 293, 268, 318],
  [268, 251, 267, 242, 254, 243, 247, 256, 251, 251, 243, 284],
];
const response: PingResponse = {
  success: true, generated_at: 1794296885, bucket_sec: 300,
  series: {
    key: "__avg__", label: "平均", current_ms: 551, loss_pct: 0.10630315157578789,
    buckets: [264, 287, 285, 261, 255, 250, 257, 272, 306, 292, 268, 297].map((ms, index) => ({ ms, loss: index === 1 ? 0.6060606060606061 : index === 2 ? 0.6172839506172839 : 0 })),
  },
  all_series: recordedLatencies.map((values, index) => ({
    key: `redacted-target-${index}`, label: ["电信", "移动", "联通"][index], isp: ["telecom", "mobile", "unicom"][index],
    current_ms: [163, 1217, 274][index], loss_pct: [0.13131565782891447, 0.16883441720860431, 0.018759379689844924][index],
    buckets: values.map((ms, position) => ({ ms, loss: index === 0 && position === 1 ? 1.8181818181818181 : index === 0 && position === 2 ? 1.8518518518518519 : 0 })),
  })),
};
const dayLatencies = [265, 216, 216, 200, 233, 253, 337, 306, 326, 349, 373, 365, 342, 305, 359, 329, 279, 211, 206, 176, 165, 164, 165, 163, 163, 161, 162, 162, 161, 162, 162, 162, 163, 187, 179, 203, 205, 214, 214, 232, 246, 264, 296, 279, 279, 278, 239, 329];
const dayResponse: PingResponse = {
  success: true, generated_at: 1794296886, bucket_sec: 1800,
  all_series: [{ key: "redacted-target", label: "电信", current_ms: 163, loss_pct: 0.13131565782891447, buckets: dayLatencies.map(ms => ({ ms, loss: 0 })) }],
};

async function verify() {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => Response.json(response)) as typeof fetch;
    const parsed = await fetchPingHistory(0, "1h", new AbortController().signal);
    assert.equal(Object.hasOwn(parsed, "buckets"), false);
    const rows = pingHistoryRows(parsed, 1);
    assert.equal(rows.length, 12);
    assert.equal(rows[0].time, 1794293400);
    assert.equal(rows[11].time, 1794296700);
    assert.equal(rows[0].latency0, 240);
    assert.equal(rows[11].latency2, 284);
    assert.equal(rows[1].loss0, 1.8181818181818181);
    assert.equal(pingHistoryRows({ ...parsed, buckets: 999 }, 1).length, 12);
    assert.equal(pingHistoryRows(dayResponse, 24).length, 48);
    assert.equal(pingHistoryRows(dayResponse, 12).length, 24);
    const uneven = { ...parsed, all_series: [parsed.all_series![0], { ...parsed.all_series![1], buckets: [{ ms: 99, loss: 100 }] }] };
    const aligned = pingHistoryRows(uneven, 1);
    assert.equal(aligned[0].loss1, null);
    assert.equal(aligned[11].loss1, 100);
    assert.equal(aligned[11].latency1, null);
    assert.deepEqual(pingHistoryRows({ ...parsed, all_series: [] }, 1), []);
    assert.deepEqual(pingHistoryRows({ ...parsed, generated_at: undefined }, 1), []);
    assert.deepEqual(pingHistoryRows({ ...parsed, bucket_sec: 0 }, 1), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
void verify().catch(error => { setTimeout(() => { throw error; }, 0); });
