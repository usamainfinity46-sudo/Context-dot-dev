import { BasicCrawler, Configuration, RequestQueue } from "crawlee";
import robotsParserImport from "robots-parser";
import * as cheerio from "cheerio";
import path from "node:path";
import type { Job, PageResult } from "@context/shared";
import { safeFetch, requireHtml, validateTarget } from "./network.js";
import { normalizeUrl, parsePage } from "./parse.js";
import { extract } from "./extract.js";
const robotsParser = robotsParserImport as unknown as (
  url: string,
  body: string,
) => {
  isAllowed: (url: string, agent: string) => boolean | undefined;
  getCrawlDelay: (agent: string) => number | undefined;
  getSitemaps: () => string[];
};

export function pathAllowed(url: string, include: string, exclude: string) {
  const pathname = new URL(url).pathname;
  const parts = (v: string) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return (
    (!parts(include).length ||
      parts(include).some((p) => pathname.includes(p))) &&
    !parts(exclude).some((p) => pathname.includes(p))
  );
}
export async function crawl(
  job: Job,
  dir: string,
  signal: AbortSignal,
  save: () => void,
  seeds?: string[],
) {
  const options = job.options;
  const origin = new URL(job.url).origin;
  const robotsCache = new Map<string, ReturnType<typeof robotsParser>>();
  const robots = async (url: string) => {
    const site = new URL(url).origin;
    let rules = robotsCache.get(site);
    if (!rules) {
      const r = await safeFetch(site + "/robots.txt", {
        signal,
        maxBytes: 512000,
      });
      if (r.status !== 404 && (r.status < 200 || r.status >= 300))
        throw new Error(`Cannot verify robots.txt: HTTP ${r.status}`);
      rules = robotsParser(
        site + "/robots.txt",
        r.status === 404 ? "" : r.body.toString("utf8"),
      );
      robotsCache.set(site, rules);
    }
    return rules;
  };
  const allowed = async (url: string) => {
    if (options.sameOrigin && new URL(url).origin !== origin) return false;
    if (!pathAllowed(url, options.include, options.exclude)) return false;
    await validateTarget(url);
    return (await robots(url)).isAllowed(url, "ContextLocal") !== false;
  };
  const enforce = async (url: string) => {
    if (!(await allowed(url)))
      throw new Error(
        "Crawl navigation blocked by robots.txt, origin, or path filters.",
      );
  };
  const initial = [...(seeds?.length ? seeds : [job.url])];
  // Discover a bounded set of sitemap URLs, including one level of sitemap indexes.
  if (!seeds?.length) {
    const rules = await robots(job.url);
    const maps = [
      new URL("/sitemap.xml", job.url).href,
      ...rules.getSitemaps(),
    ].slice(0, 4);
    const seenMaps = new Set<string>();
    for (let i = 0; i < maps.length && i < 8; i++) {
      const sitemap = maps[i];
      if (seenMaps.has(sitemap) || new URL(sitemap).origin !== origin) continue;
      seenMaps.add(sitemap);
      try {
        const r = await safeFetch(sitemap, {
          signal,
          maxBytes: 2 * 1024 * 1024,
        });
        if (r.status !== 200) continue;
        const $ = cheerio.load(r.body.toString("utf8"), { xmlMode: true });
        if ($("sitemapindex").length) {
          $("loc")
            .slice(0, 4)
            .each((_, el) => {
              try {
                maps.push(new URL($(el).text(), sitemap).href);
              } catch {}
            });
        } else
          $("loc")
            .slice(0, options.maxPages)
            .each((_, el) => {
              try {
                initial.push(new URL($(el).text(), sitemap).href);
              } catch {}
            });
      } catch (e) {
        signal.throwIfAborted();
        job.error = `Sitemap discovery incomplete: ${e instanceof Error ? e.message : "fetch failed"}`;
      }
    }
  }
  const configuration = new Configuration({
    persistStorage: true,
    storageClientOptions: {
      localDataDirectory: path.join(dir, "crawl-storage"),
    },
  });
  const queue = await RequestQueue.open(job.id, { config: configuration });
  const scheduled = new Set<string>();
  const found: NonNullable<Job["discovered"]> = [];
  const pages: PageResult[] = [];
  job.discovered = found;
  job.pages = pages;
  const add = async (input: string, depth: number, source: string) => {
    if (scheduled.size >= options.maxPages || depth > options.maxDepth) return;
    let url: string;
    try {
      url = normalizeUrl(input);
    } catch {
      return;
    }
    if (scheduled.has(url)) return;
    if (!(await allowed(url))) return;
    if (scheduled.size >= options.maxPages || scheduled.has(url)) return;
    scheduled.add(url);
    found.push({ url, depth, source });
    await queue.addRequest({ url, uniqueKey: url, userData: { depth } });
    save();
  };
  for (const u of initial) {
    signal.throwIfAborted();
    await add(u, 0, seeds?.length ? "selected" : "seed / sitemap");
  }
  const crawler = new BasicCrawler(
    {
      requestQueue: queue,
      maxConcurrency: 2,
      maxRequestRetries: 0,
      maxRequestsPerCrawl: options.maxPages,
      requestHandlerTimeoutSecs: 180,
      async requestHandler({ request }) {
        signal.throwIfAborted();
        const depth = Number(request.userData.depth || 0);
        const rules = await robots(request.url);
        const delay = Math.min(
          30000,
          Math.max(0, (rules.getCrawlDelay("ContextLocal") || 0) * 1000),
        );
        if ((rules.getCrawlDelay("ContextLocal") || 0) > 30)
          throw new Error(
            "robots.txt crawl delay exceeds supported 30 seconds; URL skipped.",
          );
        if (delay)
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              signal.removeEventListener("abort", abort);
              resolve();
            }, delay);
            const abort = () => {
              clearTimeout(timer);
              reject(new Error("Cancelled"));
            };
            signal.addEventListener("abort", abort, { once: true });
          });
        let links: PageResult["links"];
        if (job.kind === "crawl") {
          const page = await extract(
            request.url,
            options,
            dir,
            signal,
            (s) => {
              job.progress = `${pages.length}/${options.maxPages} pages · ${s}`;
              save();
            },
            `page-${found.findIndex((f) => f.url === request.url)}`,
            enforce,
          );
          if (options.sameOrigin && new URL(page.finalUrl).origin !== origin)
            throw new Error("Redirect left the crawl origin.");
          pages.push(page);
          links = page.links;
        } else {
          const response = await safeFetch(request.url, {
            signal,
            beforeRequest: enforce,
          });
          requireHtml(response);
          if (options.sameOrigin && new URL(response.url).origin !== origin)
            throw new Error("Redirect left the mapping origin.");
          links = parsePage(
            response.body.toString("utf8"),
            response.url,
            "full",
          ).links;
        }
        if (depth < options.maxDepth && !seeds?.length)
          for (const link of links) {
            signal.throwIfAborted();
            await add(link.url, depth + 1, "internal link");
          }
        job.progress = `${found.length} URLs discovered · ${pages.length} pages extracted`;
        save();
      },
      failedRequestHandler({ request }, error) {
        const row = found.find((f) => f.url === request.url);
        if (row) row.error = error.message;
        save();
      },
    },
    configuration,
  );
  const abort = () => {
    void crawler.autoscaledPool?.abort();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await crawler.run();
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", abort);
    await queue.drop();
  }
  if (!found.length)
    throw new Error(
      "No eligible URLs found. Check robots.txt, origin, and path filters.",
    );
}
