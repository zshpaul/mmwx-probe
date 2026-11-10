import { cpuCoreUsage, loadAverage, loadAverageTitle, pingState } from "./telemetry-display";

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
equal(loadAverage("1.64 1.39 1.20 4/278 41234"), "1.64, 1.39, 1.20");
equal(loadAverage("1 0.5 0"), "1.00, 0.50, 0.00");
equal(loadAverage("  1.64\t1.39 1.20  "), "1.64, 1.39, 1.20");
equal(loadAverage(""), undefined);
equal(loadAverage("  "), undefined);
equal(loadAverage(null), undefined);
equal(loadAverage(undefined), undefined);
for (const invalid of ["invalid", "1 2", "1 2 3 4", "1 bad 3", "1 2 3 invalid 5", "-1 2 3", "NaN 2 3", "Infinity 2 3"]) equal(loadAverage(invalid), invalid);
equal(loadAverageTitle("1.64 1.39 1.20 4/278 41234"), "1.64, 1.39, 1.20\n1.64 1.39 1.20 4/278 41234");
equal(loadAverageTitle("invalid"), "invalid");
