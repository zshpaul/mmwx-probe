export function globeRotationStep(elapsed: number, dragging: boolean, reducedMotion: boolean, visible: boolean) {
  if (dragging || reducedMotion || !visible || !Number.isFinite(elapsed) || elapsed <= 0) return 0;
  return Math.min(elapsed, 100) * .002 * 60 / 1000 * 180 / Math.PI;
}
