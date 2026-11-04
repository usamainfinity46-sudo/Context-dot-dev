import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { Job } from "@context/shared";
export class Store {
  db: Database.Database;
  constructor(public dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(path.join(dir, "context.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL)",
    );
    for (const row of this.db
      .prepare("SELECT data FROM jobs WHERE status IN ('running','queued')")
      .all() as { data: string }[]) {
      const job: Job = JSON.parse(row.data);
      this.save({
        ...job,
        status: "interrupted",
        finishedAt: new Date().toISOString(),
        progress: "Interrupted by server restart",
        error:
          "Server stopped before this job finished. Run it again to resume extraction.",
      });
    }
  }
  save(job: Job) {
    this.db
      .prepare(
        "INSERT INTO jobs VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data",
      )
      .run(job.id, job.createdAt, job.status, JSON.stringify(job));
  }
  get(id: string): Job | undefined {
    const row = this.db.prepare("SELECT data FROM jobs WHERE id=?").get(id) as
      | { data: string }
      | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  list() {
    return (
      this.db
        .prepare("SELECT data FROM jobs ORDER BY created_at DESC LIMIT 200")
        .all() as { data: string }[]
    ).map(({ data }) => {
      const { result, pages, discovered, ...summary } = JSON.parse(data) as Job;
      return { ...summary, pageCount: pages?.length ?? (result ? 1 : 0) };
    });
  }
  remove(id: string) {
    this.db.prepare("DELETE FROM jobs WHERE id=?").run(id);
    fs.rmSync(this.jobDir(id), { recursive: true, force: true });
  }
  jobDir(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid job ID");
    const dir = path.join(this.dir, "files", id);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
}
export const store = new Store(config.dataDir);
