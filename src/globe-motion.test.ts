import { geoOrthographic } from "d3-geo";
import { advanceGlobeLongitude, globeRotationStep } from "./globe-motion";

const assert = {
  ok(value: boolean) { if (!value) throw new Error("Globe rotation invariant failed"); },
  equal(actual: number, expected: number) { if (actual !== expected) throw new Error(`Expected ${expected}, received ${actual}`); },
};
const frame = 1000 / 60;
assert.ok(Math.abs(globeRotationStep(frame, false, true) - .002 * 180 / Math.PI) < 1e-10);
assert.equal(globeRotationStep(frame, true, true), 0);
assert.equal(globeRotationStep(frame, false, false), 0);
assert.ok(globeRotationStep(frame, false, true) > 0);
assert.equal(globeRotationStep(5000, false, true), globeRotationStep(100, false, true));
assert.equal(globeRotationStep(Number.NaN, false, true), 0);
assert.equal(globeRotationStep(-1, false, true), 0);
assert.ok(Math.abs(globeRotationStep(frame / 2, false, true) * 2 - globeRotationStep(frame, false, true)) < 1e-10);
const longitude = -105;
const next = advanceGlobeLongitude(longitude, globeRotationStep(frame, false, true));
const before = geoOrthographic().rotate([longitude, -20])([105, 20])!;
const after = geoOrthographic().rotate([next, -20])([105, 20])!;
assert.ok(after[0] > before[0]);
assert.equal(advanceGlobeLongitude(longitude, globeRotationStep(frame, true, true)), longitude);
assert.equal(advanceGlobeLongitude(359, 2), 1);
