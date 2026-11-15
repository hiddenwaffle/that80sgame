import { globeLandPath } from './title_globe_coast.ts';
import { bakeGlobeDistance } from './title_globe_sdf.ts';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ width: number }>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
scope.onmessage = event => {
  try {
    const start = performance.now(), width = event.data.width;
    if (width !== 1024 && width !== 2048) throw new Error('Unsupported map width.');
    if (typeof OffscreenCanvas === 'undefined' || typeof Path2D === 'undefined') throw new Error('Worker 2D canvas/Path2D unavailable.');
    const result = bakeGlobeDistance(width, globeLandPath(width), new OffscreenCanvas(width, width / 2),
      progress => scope.postMessage({ progress }));
    scope.postMessage({ pixels: result.pixels, info: { ...result.info, workerTotalMs: performance.now() - start } }, [result.pixels.buffer]);
  } catch (error) {
    scope.postMessage({ error: String(error) });
  }
};
