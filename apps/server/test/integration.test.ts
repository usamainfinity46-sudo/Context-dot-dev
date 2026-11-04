import "./setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
process.env.ALLOW_LOCAL_TARGETS = "true";
const { extract } = await import("../src/extract.js");
const { safeFetch } = await import("../src/network.js");
const { optionsSchema } = await import("../src/validation.js");
const { closeBrowser } = await import("../src/browser.js");
const { crawl } = await import("../src/crawl.js");
const { runner } = await import("../src/runner.js");
const { store } = await import("../src/store.js");
const { fixture } = await import("./fixture.js");
test("real HTTP/browser extraction, lazy images, screenshots, no retries, robots and small crawls", async () => {
  const { server, url } = await fixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "context-integration-"));
  const signal = new AbortController().signal;
  try {
    const http = await extract(
      url,
      optionsSchema.parse({ mode: "http", content: "full" }),
      dir,
      signal,
      () => {},
    );
    assert.equal(http.mode, "http");
    assert.equal(http.title, "Extraction fixture");
    assert.equal(http.renderedHtml, undefined);
    assert.ok(http.rawHtml?.includes("<!doctype html>"));
    assert.ok(http.images.some((i) => i.url === url + "/assets/first.png?w=2"));
    assert.equal(http.forms[0].fields[0].label, "Full name");
    assert.ok(!JSON.stringify(http.forms).includes("DO_NOT_COLLECT"));
    const browser = await extract(
      url,
      optionsSchema.parse({
        mode: "browser",
        outputs: ["markdown", "html", "images", "screenshot"],
        delay: 50,
        scroll: true,
      }),
      dir,
      signal,
      () => {},
    );
    assert.equal(browser.mode, "browser");
    assert.ok(browser.renderedHtml?.includes('data-loaded="true"'));
    assert.ok(
      browser.images.some(
        (i) =>
          i.url.endsWith("/assets/lazy.png") && i.types.includes("currentSrc"),
      ),
    );
    assert.ok(
      browser.images.some((i) => i.types.includes("computed-background")),
    );
    assert.ok(browser.screenshot);
    assert.ok(fs.statSync(path.join(dir, browser.screenshot!)).size > 1000);
    const auto = await extract(
      url + "/shell",
      optionsSchema.parse({ mode: "auto", outputs: ["markdown", "html"] }),
      dir,
      signal,
      () => {},
    );
    assert.equal(auto.mode, "browser");
    assert.ok(auto.markdown.includes("Rendered application"));
    assert.ok(auto.modeReason.includes("JavaScript shell"));
    await assert.rejects(
      extract(
        url + "/blocked",
        optionsSchema.parse({ mode: "auto" }),
        dir,
        signal,
        () => {},
      ),
      /HTTP 403/,
    );
    await assert.rejects(safeFetch(url + "/redirect-private"), /metadata/);
    const job = {
      id: randomUUID(),
      url,
      kind: "map" as const,
      options: optionsSchema.parse({ maxPages: 4, maxDepth: 1 }),
      status: "running" as const,
      createdAt: new Date().toISOString(),
      progress: "",
    };
    await crawl(job, dir, signal, () => {});
    const discovered = (job as typeof job & { discovered: { url: string }[] })
      .discovered;
    assert.ok(discovered.some((d) => d.url === url + "/child"));
    assert.ok(!discovered.some((d) => d.url === url + "/private"));
    assert.ok(discovered.length <= 4);
    const completed = runner.create(
      url,
      "scrape",
      optionsSchema.parse({ mode: "http" }),
    );
    for (
      let i = 0;
      i < 100 &&
      ["queued", "running"].includes(store.get(completed.id)!.status);
      i++
    )
      await new Promise((r) => setTimeout(r, 50));
    const saved = store.get(completed.id)!;
    assert.equal(saved.status, "completed");
    assert.ok(saved.startedAt);
    assert.ok(saved.finishedAt);
    assert.equal(saved.result?.title, "Extraction fixture");
    const cancelled = runner.create(
      url,
      "scrape",
      optionsSchema.parse({ mode: "browser", delay: 5000 }),
    );
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(runner.cancel(cancelled.id), true);
    for (let i = 0; i < 100 && runner.active.has(cancelled.id); i++)
      await new Promise((r) => setTimeout(r, 50));
    assert.equal(store.get(cancelled.id)?.status, "cancelled");
    assert.equal(runner.active.has(cancelled.id), false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeBrowser();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
