import fs from "node:fs/promises";
import path from "node:path";
import type { ImageCandidate, Job, PageResult } from "@context/shared";
import { safeFetch } from "./network.js";
import { limits } from "./config.js";
import { store } from "./store.js";
export const allPages = (job: Job): PageResult[] =>
  job.result ? [job.result] : job.pages || [];
export const allImages = (job: Job): ImageCandidate[] =>
  allPages(job).flatMap((p) => p.images);
const extensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/bmp": "bmp",
};
const inFlight = new Map<string, Promise<ImageCandidate>>();
let activeTransfers = 0;
const waitingTransfers: (() => void)[] = [];
async function inDownloadSlot<T>(task: () => Promise<T>) {
  if (activeTransfers >= 3)
    await new Promise<void>((resolve) => waitingTransfers.push(resolve));
  activeTransfers++;
  try {
    return await task();
  } finally {
    activeTransfers--;
    waitingTransfers.shift()?.();
  }
}
export const hasDownloads = (jobId: string) =>
  [...inFlight.keys()].some((k) => k.startsWith(jobId + ":"));
export function downloadImage(
  jobId: string,
  imageId: string,
): Promise<ImageCandidate> {
  const key = jobId + ":" + imageId;
  if (inFlight.has(key)) return inFlight.get(key)!;
  const promise = inDownloadSlot(() => download(jobId, imageId)).finally(() =>
    inFlight.delete(key),
  );
  inFlight.set(key, promise);
  return promise;
}
async function download(jobId: string, imageId: string) {
  const job = store.get(jobId);
  if (!job) throw new Error("Job not found");
  const image = allImages(job).find((i) => i.id === imageId);
  if (!image) throw new Error("Image not found");
  if (image.status === "downloaded") return image;
  try {
    let body: Buffer, mime: string;
    if (image.url.startsWith("data:")) {
      const match = /^data:(image\/[\w.+-]+)(;base64)?,([\s\S]*)$/.exec(
        image.url,
      );
      if (!match) throw new Error("Unsupported image data URI");
      if (image.url.length > limits.image * 1.5)
        throw new Error("Image exceeds size limit");
      mime = match[1];
      body = match[2]
        ? Buffer.from(match[3], "base64")
        : Buffer.from(decodeURIComponent(match[3]));
    } else {
      const response = await safeFetch(image.url, { maxBytes: limits.image });
      if (response.status < 200 || response.status >= 300)
        throw new Error(`Image HTTP ${response.status}`);
      body = response.body;
      mime = (response.headers["content-type"] || "").split(";")[0];
    }
    if (!extensions[mime])
      throw new Error(`Unsupported image type: ${mime || "unknown"}`);
    if (body.length > limits.image) throw new Error("Image exceeds size limit");
    image.file = `image-${image.id}.${extensions[mime]}`;
    await fs.writeFile(path.join(store.jobDir(jobId), image.file), body);
    image.mime = mime;
    image.status = "downloaded";
    delete image.error;
  } catch (e) {
    image.status = "failed";
    image.error = e instanceof Error ? e.message : "Download failed";
  }
  // Merge into the freshest record so simultaneous downloads cannot overwrite one another.
  const fresh = store.get(jobId);
  if (fresh) {
    for (const item of allImages(fresh))
      if (item.id === imageId) Object.assign(item, image);
    store.save(fresh);
  }
  return image;
}
