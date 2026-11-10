import { globeRotationStep } from "./globe-motion";

const assert = {
  ok(value: boolean) { if (!value) throw new Error("Globe rotation invariant failed"); },
  equal(actual: number, expected: number) { if (actual !== expected) throw new Error(`Expected ${expected}, received ${actual}`); },
};
const frame = 1000 / 60;
assert.ok(Math.abs(globeRotationStep(frame, false, false, true) - .002 * 180 / Math.PI) < 1e-10);
assert.equal(globeRotationStep(frame, true, false, true), 0);
assert.equal(globeRotationStep(frame, false, true, true), 0);
assert.equal(globeRotationStep(frame, false, false, false), 0);
assert.ok(globeRotationStep(frame, false, false, true) > 0);
assert.equal(globeRotationStep(5000, false, false, true), globeRotationStep(100, false, false, true));
assert.equal(globeRotationStep(Number.NaN, false, false, true), 0);
assert.equal(globeRotationStep(-1, false, false, true), 0);
assert.ok(Math.abs(globeRotationStep(frame / 2, false, false, true) * 2 - globeRotationStep(frame, false, false, true)) < 1e-10);
