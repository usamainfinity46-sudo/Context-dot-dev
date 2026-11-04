import express from "express";
import path from "node:path";
import fs from "node:fs";
import archiver from "archiver";
import { z } from "zod";
import { config } from "./config.js";
import { store } from "./store.js";
import { runner } from "./runner.js";
import { jobSchema, schemaValidator } from "./validation.js";
import { validateTarget } from "./network.js";
import { allPages, allImages, downloadImage, hasDownloads } from "./files.js";
import { closeBrowser } from "./browser.js";
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "128kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  const host = req.hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host))
    return res.status(403).json({
      error: "Use the localhost address to access this personal app.",
    });
  if (
    req.headers.origin &&
    req.headers.origin !== `http://${req.headers.host}` &&
    req.headers.origin !== "http://localhost:5173" &&
    req.headers.origin !== "http://127.0.0.1:5173"
  )
    return res
      .status(403)
      .json({ error: "Cross-origin requests are blocked." });
  next();
});
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    aiConfigured: !!config.apiKey,
    model: config.model,
    allowLocalTargets: config.allowLocal,
  }),
);
app.get("/api/jobs", (_req, res) => res.json(store.list()));
app.post("/api/jobs", async (req, res) => {
  const parsed = jobSchema.parse(req.body);
  await validateTarget(parsed.url);
  if (parsed.options.schema) schemaValidator(parsed.options.schema);
  if (runner.pending.length >= 20)
    return res
      .status(429)
      .json({ error: "The local queue is full. Wait for a job to finish." });
  if (parsed.kind === "crawl" && parsed.urls)
    for (const url of parsed.urls) await validateTarget(url);
  res
    .status(202)
    .json(runner.create(parsed.url, parsed.kind, parsed.options, parsed.urls));
});
app.param("id", (req, res, next, id) => {
  if (!/^[0-9a-f-]{36}$/.test(id) || !store.get(id))
    return res.status(404).json({ error: "Job not found" });
  next();
});
app.get("/api/jobs/:id", (req, res) => res.json(store.get(req.params.id)));
app.post("/api/jobs/:id/cancel", (req, res) => {
  runner.cancel(req.params.id);
  res.json(store.get(req.params.id));
});
app.delete("/api/jobs/:id", (req, res) => {
  if (hasDownloads(req.params.id))
    return res
      .status(409)
      .json({
        error: "Wait for image downloads to finish before deleting this job.",
      });
  if (["queued", "running"].includes(store.get(req.params.id)!.status))
    return res
      .status(409)
      .json({ error: "Cancel this job before deleting it." });
  store.remove(req.params.id);
  res.status(204).end();
});
const imageTasks = new Set<string>();
let activeDownloads = 0;
let previewDownloads = 0;
const previewWaiters: (() => void)[] = [];
app.get("/api/jobs/:id/images/:image/preview", async (req, res) => {
  const job = store.get(req.params.id)!;
  const image = allImages(job).find((i) => i.id === req.params.image);
  if (!image) return res.status(404).end();
  if (
    image.types.includes("inline-svg") ||
    image.mime === "image/svg+xml" ||
    /\.svg(?:\?|$)|^data:image\/svg/i.test(image.url)
  )
    return res.status(415).end();
  if (["queued", "running"].includes(job.status)) return res.status(409).end();
  if (previewWaiters.length >= 100) return res.status(429).end();
  if (previewDownloads >= 4)
    await new Promise<void>((resolve) => previewWaiters.push(resolve));
  previewDownloads++;
  try {
    const downloaded = await downloadImage(job.id, image.id);
    if (!downloaded.file || downloaded.mime === "image/svg+xml")
      return res.status(415).end();
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.sendFile(path.join(store.jobDir(job.id), downloaded.file));
  } finally {
    previewDownloads--;
    previewWaiters.shift()?.();
  }
});
app.post("/api/jobs/:id/images/download", async (req, res) => {
  const job = store.get(req.params.id)!;
  if (["queued", "running"].includes(job.status))
    return res.status(409).json({ error: "Wait for extraction to finish." });
  const { ids } = z
    .object({
      ids: z
        .array(z.string().regex(/^[0-9a-f]{20}$/))
        .max(300)
        .optional(),
    })
    .parse(req.body);
  if (imageTasks.has(job.id) || activeDownloads >= 2)
    return res
      .status(409)
      .json({ error: "An image batch is already running. Please wait." });
  imageTasks.add(job.id);
  activeDownloads++;
  try {
    const images = allImages(job).filter((i) => !ids || ids.includes(i.id));
    const unique = [...new Map(images.map((i) => [i.id, i])).values()];
    for (let i = 0; i < unique.length; i += 3)
      await Promise.all(
        unique.slice(i, i + 3).map((image) => downloadImage(job.id, image.id)),
      );
    res.json(store.get(job.id));
  } finally {
    imageTasks.delete(job.id);
    activeDownloads--;
  }
});
app.get("/api/jobs/:id/files/:file", (req, res) => {
  const file = req.params.file;
  if (
    !/^(page(?:-\d+)?-screenshot\.png|image-[a-f0-9]{20}\.(png|jpg|webp|gif|avif|svg|ico|bmp))$/.test(
      file,
    )
  )
    return res.status(404).end();
  const local = path.join(store.jobDir(req.params.id), file);
  if (!fs.existsSync(local))
    return res.status(404).json({ error: "File not available" });
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  if (req.query.download || file.endsWith(".svg")) res.attachment(file);
  res.sendFile(local);
});
app.get("/api/jobs/:id/export", async (req, res) => {
  const job = store.get(req.params.id)!;
  const pages = allPages(job);
  const format = req.query.format || "zip";
  if (format === "json") {
    res.attachment("extraction.json").json(job);
    return;
  }
  if (format === "markdown") {
    res
      .attachment("extraction.md")
      .type("text/markdown")
      .send(
        pages
          .map((p) => `# ${p.title}\n\nSource: ${p.finalUrl}\n\n${p.markdown}`)
          .join("\n\n---\n\n"),
      );
    return;
  }
  if (format === "raw" || format === "rendered") {
    const index = Number(req.query.page || 0);
    const page = pages[index];
    const html = format === "raw" ? page?.rawHtml : page?.renderedHtml;
    if (!html)
      return res
        .status(404)
        .json({ error: "This HTML capture is unavailable." });
    res.attachment(`${format}.html`).type("text/plain").send(html);
    return;
  }
  if (format !== "zip" && format !== "images")
    return res.status(400).json({ error: "Unknown export format" });
  res.attachment(format === "images" ? "images.zip" : "extraction.zip");
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("error", () => res.destroy());
  res.on("close", () => {
    void archive.abort();
  });
  archive.pipe(res);
  const selected =
    typeof req.query.ids === "string"
      ? new Set(req.query.ids.split(","))
      : undefined;
  if (format === "zip") {
    archive.append(JSON.stringify(job, null, 2), { name: "extraction.json" });
    for (const [i, p] of pages.entries()) {
      const dir = `page-${i + 1}/`;
      if (p.markdown) archive.append(p.markdown, { name: dir + "content.md" });
      if (p.rawHtml) archive.append(p.rawHtml, { name: dir + "raw.html" });
      if (p.renderedHtml)
        archive.append(p.renderedHtml, { name: dir + "rendered.html" });
      if (p.screenshot)
        archive.file(path.join(store.jobDir(job.id), p.screenshot), {
          name: dir + "screenshot.png",
        });
    }
  }
  for (const image of [
    ...new Map(allImages(job).map((i) => [i.id, i])).values(),
  ])
    if (
      image.file &&
      image.status === "downloaded" &&
      (!selected || selected.has(image.id))
    )
      archive.file(path.join(store.jobDir(job.id), image.file), {
        name: "images/" + image.file,
      });
  await archive.finalize();
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "API endpoint not found" }),
);
const webDir = path.resolve(import.meta.dirname, "../../../../../web/dist");
// Compiled location: apps/server/dist/apps/server/src -> apps/web/dist.
const candidate = path.resolve(process.cwd(), "../web/dist");
const staticDir = fs.existsSync(candidate) ? candidate : webDir;
app.use(express.static(staticDir));
app.get("/{*path}", (_req, res) =>
  res.sendFile(path.join(staticDir, "index.html")),
);
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (res.headersSent) return;
    res.status(error instanceof z.ZodError ? 400 : 400).json({
      error:
        error instanceof z.ZodError
          ? error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")
          : error instanceof Error
            ? error.message
            : "Request failed",
    });
  },
);
const server = app.listen(config.port, config.host, () =>
  console.log(`Context Local ready at http://localhost:${config.port}`),
);
async function shutdown() {
  server.close();
  for (const controller of runner.active.values()) controller.abort();
  await closeBrowser();
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
