import type { GlobeBakeProgress, GlobeMapWidth } from './title_globe_sdf.ts';

export type GlobeFieldInfo = Record<string, number | string | boolean>;
export interface GlobeField { width: GlobeMapWidth; pixels: Uint8ClampedArray; info: GlobeFieldInfo }
export interface GlobeFieldStatus {
  phase: 'idle' | 'baking' | 'ready' | 'failed';
  requestedWidth: number;
  currentWidth: number;
  completed: number;
  total: number;
  stage: string;
  startedAt: number;
  readyAt: number;
  bakes: number;
  error: string;
}
type WorkerFactory = () => Worker;

function loadWorker(width: GlobeMapWidth, signal: AbortSignal, progress: (p: GlobeBakeProgress) => void, createWorker: WorkerFactory): Promise<GlobeField> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    const close = () => {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();signal.removeEventListener('abort', abort);
    };
    const fail = (error: Error) => { close();reject(error); };
    const abort = () => fail(new DOMException('Globe bake cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort();return; }
    worker.onmessage = event => {
      const result = event.data as { progress?: GlobeBakeProgress; pixels?: Uint8ClampedArray; info?: GlobeFieldInfo; error?: string };
      if (result.progress) { progress(result.progress);return; }
      if (result.error || !(result.pixels instanceof Uint8ClampedArray) || result.pixels.length !== width * width * 2
          || result.info?.width !== width || result.info.height !== width / 2) {
        fail(new Error(result.error ?? 'Globe worker returned an invalid map.'));return;
      }
      close();
      resolve({ width, pixels: result.pixels, info: { ...result.info, mode: 'worker', roundTripMs: performance.now() - started } });
    };
    worker.onerror = event => fail(new Error(event.message || 'Globe worker failed.'));
    worker.onmessageerror = () => fail(new Error('Globe worker message could not be read.'));
    try { worker.postMessage({ width }); }
    catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  });
}

/** One shared CPU field survives title recreation. Only larger display buckets need another bake. */
export class GlobeFieldCache {
  current: GlobeField | null = null;
  onError: ((error: Error) => void) | null = null;
  readonly status: GlobeFieldStatus = { phase: 'idle', requestedWidth: 0, currentWidth: 0, completed: 0, total: 0,
    stage: '', startedAt: 0, readyAt: 0, bakes: 0, error: '' };
  private readonly createWorker: WorkerFactory;
  private readonly listeners = new Set<() => void>();
  private abort: AbortController | null = null;
  private pending: Promise<GlobeField> | null = null;

  constructor(createWorker: WorkerFactory = () => new Worker(new URL('./title_globe_worker.ts', import.meta.url), { type: 'module' })) {
    this.createWorker = createWorker;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);listener();
    return () => { this.listeners.delete(listener); };
  }

  private changed(): void { for (const listener of this.listeners) listener(); }

  request(width: GlobeMapWidth): Promise<GlobeField> {
    if (width !== 1024 && width !== 2048) throw new Error('Unsupported globe map width.');
    if (this.current && this.current.width >= width) return Promise.resolve(this.current);
    if (this.pending && this.status.requestedWidth >= width) return this.pending;
    this.abort?.abort();
    const abort = this.abort = new AbortController();
    Object.assign(this.status, { phase: 'baking', requestedWidth: width, completed: 0, total: 4 * width + 2,
      stage: 'starting', startedAt: performance.now(), readyAt: 0, bakes: this.status.bakes + 1, error: '' });
    this.changed();
    const pending = loadWorker(width, abort.signal, p => {
      if (this.abort !== abort || abort.signal.aborted) return;
      if (p.total !== 4 * width + 2 || !Number.isFinite(p.completed) || p.completed < this.status.completed || p.completed > p.total) return;
      Object.assign(this.status, p);this.changed();
    }, this.createWorker).then(field => {
      if (abort.signal.aborted) throw new DOMException('Globe bake cancelled', 'AbortError');
      this.current = field;
      Object.assign(this.status, { phase: 'ready', currentWidth: width, completed: this.status.total, stage: 'done', readyAt: performance.now() });
      this.pending = null;this.changed();
      return field;
    }).catch(error => {
      if (this.abort === abort && !abort.signal.aborted) {
        this.pending = null;
        Object.assign(this.status, { phase: 'failed', error: String(error) });this.changed();
        this.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    });
    this.pending = pending;
    // Boot awaits after its other loading work. A worker can fail before that await attaches.
    void pending.catch(() => undefined);
    return pending;
  }

  dispose(): void {
    this.abort?.abort();this.abort = null;this.pending = null;
    this.listeners.clear();this.current = null;
  }
}

export const titleGlobeFields = new GlobeFieldCache();
