export function globeRotationStep(elapsed: number, dragging: boolean, visible: boolean) {
  if (dragging || !visible || !Number.isFinite(elapsed) || elapsed <= 0) return 0;
  return Math.min(elapsed, 100) * .002 * 60 / 1000 * 180 / Math.PI;
}

export function advanceGlobeLongitude(longitude: number, step: number) {
  return (longitude + step) % 360;
}
