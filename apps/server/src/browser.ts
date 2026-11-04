import { chromium, devices, type Browser } from "playwright";
import type { Options, ImageCandidate } from "@context/shared";
import { safeFetch } from "./network.js";
import { limits } from "./config.js";
let browserPromise: Promise<Browser> | undefined;
async function getBrowser() {
  if (!browserPromise)
    browserPromise = chromium
      .launch({ headless: true, args: ["--disable-dev-shm-usage"] })
      .then((b) => {
        b.on("disconnected", () => {
          browserPromise = undefined;
        });
        return b;
      })
      .catch((e) => {
        browserPromise = undefined;
        throw e;
      });
  return browserPromise;
}
export async function closeBrowser() {
  if (browserPromise) {
    await (await browserPromise).close();
    browserPromise = undefined;
  }
}
export async function captureBrowser(
  url: string,
  options: Options,
  screenshotPath: string,
  signal: AbortSignal,
  beforeRequest?: (url: string) => Promise<void>,
) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    ...(options.viewport === "mobile"
      ? devices["iPhone 13"]
      : { viewport: { width: 1440, height: 1000 } }),
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  const abort = () => {
    void context.close().catch(()=>{});
  };
  signal.addEventListener("abort", abort, { once: true });
  const deadline = setTimeout(abort, 90_000);
  let totalBytes = 0,
    requests = 0;
  const warnings = new Set<string>();
  let rawHtml: string | undefined;
  try {
    await context.route("**/*", async (route) => {
      try {
        const req = route.request();
        if (!["GET", "HEAD"].includes(req.method())) return await route.abort();
        let previous=req.redirectedFrom(),redirectCount=0;
        while(previous){redirectCount++;previous=previous.redirectedFrom();}
        if(redirectCount>limits.redirects)throw new Error('Browser redirect limit exceeded.');
        if (
          req.isNavigationRequest() &&
          req.frame() === req.frame().page().mainFrame()
        )
          await beforeRequest?.(req.url());
        if (++requests > 350) throw new Error("Browser request limit reached");
        const response = await safeFetch(req.url(), {
          signal,
          redirects: false,
          maxBytes: limits.html,
          headers: {
            accept: req.headers()["accept"] || "*/*",
            ...(req.headers()["cookie"]
              ? { cookie: req.headers()["cookie"] }
              : {}),
          },
        });
        totalBytes += response.body.length;
        if (totalBytes > 100 * 1024 * 1024)
          throw new Error("Browser transfer limit reached");
        if (
          req.isNavigationRequest() &&
          req.frame() === req.frame().page().mainFrame() &&
          response.status === 200 &&
          /html/.test(response.headers["content-type"] || "")
        )
          rawHtml = response.body.toString("utf8");
        const headers = { ...response.headers };
        delete headers["content-security-policy-report-only"];
        delete headers["report-to"];
        delete headers["nel"];
        await route.fulfill({
          status: response.status,
          headers,
          body: response.body,
        });
      } catch (e) {
        warnings.add(e instanceof Error ? e.message : "Subrequest blocked");
        await route.abort().catch(() => {});
      }
    });
    // WebSockets never pass through the validated HTTP transport.
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    page.setDefaultNavigationTimeout(30_000);
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (!response || response.status() >= 400)
      throw new Error(
        `Browser HTTP ${response?.status() || "navigation failed"} · No automatic retries were made.`,
      );
    if (!/html/i.test(response.headers()["content-type"] || ""))
      throw new Error("Unsupported content type. Expected HTML.");
    if (options.waitFor)
      await page.waitForSelector(options.waitFor, {
        state: "attached",
        timeout: 12_000,
      });
    if (options.delay) await page.waitForTimeout(options.delay);
    if (options.scroll) {
      for (let i = 0; i < 6; i++) {
        signal.throwIfAborted();
        await page.evaluate(() =>
          window.scrollBy(0, Math.min(window.innerHeight, 900)),
        );
        await page.waitForTimeout(250);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
    }
    const extras = await page.evaluate(() => {
      const found: {
        url: string;
        alt: string;
        width?: number;
        height?: number;
        types: string[];
      }[] = [];
      for (const img of Array.from(document.images))
        if (img.currentSrc)
          found.push({
            url: img.currentSrc,
            alt: img.alt,
            width: img.naturalWidth || undefined,
            height: img.naturalHeight || undefined,
            types: ["currentSrc"],
          });
      for (const el of Array.from(document.querySelectorAll("*")).slice(
        0,
        12000,
      )) {
        const value = getComputedStyle(el).backgroundImage;
        for (const m of value.matchAll(/url\(["']?([^"'\)]+)["']?\)/g))
          found.push({ url: m[1], alt: "", types: ["computed-background"] });
      }
      return found;
    });
    let screenshot: string | undefined;
    if (options.outputs.includes("screenshot")) {
      // Bound screenshot dimensions to avoid runaway memory on infinite-scroll pages.
      const height = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      if (options.fullPage && height > 20000) {
        warnings.add("Full-page screenshot clipped at 20,000 px.");
        await page.screenshot({
          path: screenshotPath,
          clip: {
            x: 0,
            y: 0,
            width: options.viewport === "mobile" ? 390 : 1440,
            height: 20000,
          },
        });
      } else
        await page.screenshot({
          path: screenshotPath,
          fullPage: options.fullPage,
          timeout: 15000,
        });
      screenshot = screenshotPath.split(/[\\/]/).pop();
    }
    const html = await page.content();
    if (Buffer.byteLength(html) > limits.html)
      throw new Error("Rendered HTML exceeds size limit.");
    return {
      html,
      rawHtml,
      finalUrl: page.url(),
      extras: extras as Omit<ImageCandidate, "id" | "status">[],
      screenshot,
      warnings: [...warnings].slice(0, 20),
    };
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", abort);
    await context.close();
  }
}
