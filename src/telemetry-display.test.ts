import { cpuCoreUsage, pingState } from "./telemetry-display";

function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${expected}, received ${actual}`);
}

equal(cpuCoreUsage(25, 4), "折合 1.00 / 4 核");
equal(cpuCoreUsage(undefined, 4), "折合 — / 4 核");
equal(cpuCoreUsage(25, 0), "折合 — / — 核");
equal(cpuCoreUsage(0, 8), "折合 0.00 / 8 核");
equal(cpuCoreUsage(NaN, 4), "折合 — / 4 核");
equal(pingState(undefined), "missing");
equal(pingState({ ms: -1, loss: -1 }), "missing");
equal(pingState({ ms: -1, loss: 100 }), "lost");
equal(pingState({ ms: 35, loss: 100 }), "lost");
equal(pingState({ ms: 35, loss: 2.5 }), "partial");
equal(pingState({ ms: 0, loss: 0 }), "ok");
equal(pingState({ ms: NaN, loss: 0 }), "missing");
