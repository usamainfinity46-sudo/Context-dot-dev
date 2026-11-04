import { randomUUID } from "node:crypto";
import type { Job, Options } from "@context/shared";
import { store } from "./store.js";
import { extract } from "./extract.js";
import { crawl } from "./crawl.js";
export class Runner {
  pending: { id: string; urls?: string[] }[] = [];
  active = new Map<string, AbortController>();
  create(url: string, kind: Job["kind"], options: Options, urls?: string[]) {
    const job: Job = {
      id: randomUUID(),
      url,
      kind,
      options,
      status: "queued",
      createdAt: new Date().toISOString(),
      progress: "Waiting for a task slot",
    };
    store.save(job);
    this.pending.push({ id: job.id, urls });
    void this.pump();
    return job;
  }
  cancel(id: string) {
    const job = store.get(id);
    if (!job) return false;
    if (!["queued", "running"].includes(job.status)) return false;
    this.active.get(id)?.abort();
    job.status = "cancelled";
    job.progress = "Cancelled";
    job.finishedAt = new Date().toISOString();
    store.save(job);
    this.pending = this.pending.filter((p) => p.id !== id);
    return true;
  }
  async pump() {
    while (this.active.size < 2 && this.pending.length) {
      const next = this.pending.shift()!;
      const job = store.get(next.id);
      if (!job || job.status !== "queued") continue;
      const controller = new AbortController();
      this.active.set(job.id, controller);
      void this.run(job, controller, next.urls).finally(() => {
        this.active.delete(job.id);
        void this.pump();
      });
    }
  }
  async run(job: Job, controller: AbortController, urls?: string[]) {
    const signal = controller.signal;
    const save = () => {
      if (!signal.aborted) store.save(job);
    };
    job.status = "running";
    job.startedAt = new Date().toISOString();
    save();
    try {
      if (job.kind === "scrape")
        job.result = await extract(
          job.url,
          job.options,
          store.jobDir(job.id),
          signal,
          (s) => {
            job.progress = s;
            save();
          },
        );
      else await crawl(job, store.jobDir(job.id), signal, save, urls);
      signal.throwIfAborted();
      job.status =
        job.result?.warnings.length ||
        job.pages?.some((p) => p.warnings.length) ||
        job.discovered?.some((d) => d.error) ||
        job.error
          ? "partial"
          : "completed";
      job.progress =
        job.status === "partial"
          ? "Finished with warnings"
          : "Extraction complete";
    } catch (e) {
      if (signal.aborted) {
        job.status = "cancelled";
        job.progress = "Cancelled";
      } else {
        job.status = "failed";
        job.error = e instanceof Error ? e.message : "Extraction failed";
        job.progress = "Extraction failed";
      }
    } finally {
      job.finishedAt = new Date().toISOString();
      store.save(job);
    }
  }
}
export const runner = new Runner();
