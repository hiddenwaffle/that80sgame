/** Bring a backdrop below the actors into view using spare room, never sacrificing the actors or changing zoom. */
export function frameBackdropBelow(cameraY: number, actorTop: number, actorBottom: number, backdropBottom: number,
  panelHeight: number, band: { top: number; bottom: number }, pixelsPerWorldY: number): number {
  if (pixelsPerWorldY <= 0) return cameraY;
  const low = actorBottom + (panelHeight / 2 - band.bottom) / pixelsPerWorldY;
  const high = actorTop + (panelHeight / 2 - band.top) / pixelsPerWorldY;
  // A cramped band already needs the ordinary formation's compromise.
  if (low > high) return cameraY;
  const wanted = backdropBottom + (panelHeight / 2 - band.bottom) / pixelsPerWorldY;
  return Math.max(low, Math.min(high, Math.max(cameraY, wanted)));
}
