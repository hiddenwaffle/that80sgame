/**
 * A small bounded queue. Visible content outranks prefetch; simultaneous requests share one job per key. The loader is told
 * the job's priority when it starts (0: waited on; above: background), and a key counts as complete unless it answers false:
 * a background failure stays incomplete, so the next wait for it tries again (Fable review P3, 2026-11-09).
 */
export class ArtQueue {
  readonly complete = new Set<string>();
  private jobs = new Map<string, { promise: Promise<void>; resolve: () => void; reject: (reason: unknown) => void; priority: number; running: boolean }>();
  private active = 0;

  private readonly load: (key: string, priority: number) => Promise<boolean | void>;
  private readonly concurrency: number;
  constructor(load: (key: string, priority: number) => Promise<boolean | void>, concurrency = 6) {
    this.load = load;
    this.concurrency = concurrency;
  }

  ready(keys: readonly string[]): boolean { return keys.every(key => this.complete.has(key)); }

  ensure(keys: readonly string[], priority = 0): Promise<void> {
    const waits = [...new Set(keys)].map(key => {
      if (this.complete.has(key)) return Promise.resolve();
      let job = this.jobs.get(key);
      if (!job) {
        let resolve!: () => void;
        let reject!: (reason: unknown) => void;
        const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
        job = { promise, resolve, reject, priority, running: false };
        this.jobs.set(key, job);
      } else job.priority = Math.min(job.priority, priority);
      return job.promise;
    });
    this.pump();
    return Promise.all(waits).then(() => undefined);
  }

  private pump(): void {
    while (this.active < this.concurrency) {
      const next = [...this.jobs].filter(([, j]) => !j.running).sort((a,b) => a[1].priority-b[1].priority)[0];
      if (!next) return;
      const [key, job] = next;
      job.running = true;
      this.active++;
      // The loader handles retries and failure placeholders. Unexpected errors remain errors,
      // but still release capacity so they cannot strand unrelated chapters behind this job.
      void Promise.resolve().then(() => this.load(key, job.priority)).then((done) => {
        if (done !== false) this.complete.add(key);
      }).finally(() => {
        this.active--;
        this.jobs.delete(key);
        this.pump();
      }).then(job.resolve, job.reject);
    }
  }
}
