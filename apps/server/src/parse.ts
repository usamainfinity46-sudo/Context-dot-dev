import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import Turndown from "turndown";
import { createHash } from "node:crypto";
import type { ImageCandidate, PageResult } from "@context/shared";
import { limits } from "./config.js";

export function resolveUrl(value: string, base: string): string | undefined {
  try {
    const u = new URL(value.trim(), base);
    if (!["https:", "http:", "data:"].includes(u.protocol)) return;
    u.hash = "";
    return u.href;
  } catch {
    return;
  }
}
export function normalizeUrl(value: string) {
  const u = new URL(value);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  return u.href;
}
export function dedupeImages(
  items: Omit<ImageCandidate, "id" | "status">[],
): ImageCandidate[] {
  const map = new Map<string, ImageCandidate>();
  for (const item of items) {
    let key: string;
    try {
      key = item.url.startsWith("data:") ? item.url : normalizeUrl(item.url);
    } catch {
      continue;
    }
    const existing = map.get(key);
    if (existing) {
      existing.types = [...new Set([...existing.types, ...item.types])];
      existing.alt ||= item.alt;
      existing.width ||= item.width;
      existing.height ||= item.height;
    } else
      map.set(key, {
        ...item,
        url: key,
        id: createHash("sha256").update(key).digest("hex").slice(0, 20),
        status: "candidate",
      });
  }
  return [...map.values()].slice(0, limits.images);
}
export function srcsetUrls(value: string): string[] {
  const candidates: string[] = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && /[\s,]/.test(value[index])) index++;
    const start = index,
      isData = value.slice(index, index + 5) === "data:";
    while (
      index < value.length &&
      !/\s/.test(value[index]) &&
      (isData || value[index] !== ",")
    )
      index++;
    const url = value.slice(start, index).replace(/,+$/, "");
    if (url) candidates.push(url);
    if (value[index] === ",") {
      index++;
      continue;
    }
    while (index < value.length && value[index] !== ",") index++;
    index++;
  }
  return candidates;
}
export function parsePage(
  html: string,
  finalUrl: string,
  content: "main" | "full",
  extras: Omit<ImageCandidate, "id" | "status">[] = [],
) {
  const $ = cheerio.load(html);
  const base =
    resolveUrl($("base[href]").first().attr("href") || finalUrl, finalUrl) ||
    finalUrl;
  const candidates: Omit<ImageCandidate, "id" | "status">[] = [...extras];
  const add = (
    value: string | undefined,
    type: string,
    alt = "",
    width?: number,
    height?: number,
  ) => {
    if (!value) return;
    const url = resolveUrl(value, base);
    if (url)
      candidates.push({
        url,
        alt,
        width: width || undefined,
        height: height || undefined,
        types: [type],
      });
  };
  $("img").each((_, el) => {
    const e = $(el);
    const alt = e.attr("alt") || "";
    const w = Number(e.attr("width")),
      h = Number(e.attr("height"));
    add(e.attr("src"), "img", alt, w, h);
    for (const attr of [
      "data-src",
      "data-original",
      "data-lazy-src",
      "data-url",
      "data-flickity-lazyload",
    ])
      add(e.attr(attr), "lazy", alt, w, h);
    for (const attr of ["srcset", "data-srcset", "data-lazy-srcset"])
      for (const v of srcsetUrls(e.attr(attr) || "")) add(v, "srcset", alt);
  });
  $("picture source").each((_, el) => {
    for (const attr of ["srcset", "data-srcset"])
      for (const v of srcsetUrls($(el).attr(attr) || "")) add(v, "picture");
    add($(el).attr("src"), "picture");
  });
  $("[style],style").each((_, el) => {
    const css = $(el).attr("style") || $(el).text();
    for (const m of css.matchAll(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/g))
      add(m[1], "background");
  });
  $(
    'meta[property="og:image"],meta[property="og:image:url"],meta[name="twitter:image"],meta[property="twitter:image"]',
  ).each((_, el) => add($(el).attr("content"), "social"));
  $('link[rel*="icon"]').each((_, el) => add($(el).attr("href"), "favicon"));
  $("video[poster]").each((_, el) => add($(el).attr("poster"), "poster"));
  $("svg").each((_, el) =>
    add(
      "data:image/svg+xml;base64," + Buffer.from($.html(el)).toString("base64"),
      "inline-svg",
      $(el).attr("aria-label") || "",
      Number($(el).attr("width")),
      Number($(el).attr("height")),
    ),
  );
  const openGraph: Record<string, string> = {};
  $('meta[property^="og:"],meta[name^="twitter:"]').each((_, el) => {
    const e = $(el);
    openGraph[e.attr("property") || e.attr("name") || ""] =
      e.attr("content") || "";
  });
  const headings: PageResult["headings"] = [];
  $("h1,h2,h3,h4,h5,h6").each((_, el) => {
    headings.push({ level: Number(el.tagName[1]), text: $(el).text().trim() });
  });
  const links: PageResult["links"] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const url = resolveUrl($(el).attr("href") || "", base);
    if (url && !url.startsWith("data:") && !seen.has(url)) {
      seen.add(url);
      links.push({
        url,
        text: $(el).text().trim(),
        internal: new URL(url).origin === new URL(finalUrl).origin,
      });
    }
  });
  const forms: PageResult["forms"] = [];
  $("form").each((_, el) => {
    const e = $(el);
    const fields: PageResult["forms"][number]["fields"] = [];
    e.find("input,textarea,select,button").each((_, field) => {
      const f = $(field);
      const id = f.attr("id");
      const label = id
        ? $("label")
            .filter((_, l) => $(l).attr("for") === id)
            .text()
            .trim()
        : "";
      fields.push({
        label:
          label ||
          f.closest("label").text().trim() ||
          f.attr("aria-label") ||
          "",
        name: f.attr("name") || "",
        type: f.attr("type") || field.tagName,
        placeholder: f.attr("placeholder") || "",
        required: f.attr("required") !== undefined,
        ...(field.tagName === "select"
          ? {
              options: f
                .find("option")
                .map((_, o) => ({
                  text: $(o).text(),
                  value: $(o).attr("value") || "",
                }))
                .get(),
            }
          : {}),
      });
    });
    forms.push({
      action: resolveUrl(e.attr("action") || finalUrl, base) || "",
      method: (e.attr("method") || "get").toUpperCase(),
      fields,
    });
  });
  const title = $("title").first().text().trim(),
    description = $('meta[name="description"]').attr("content") || "",
    canonical =
      resolveUrl($('link[rel="canonical"]').attr("href") || finalUrl, base) ||
      finalUrl,
    language = $("html").attr("lang") || "";
  // Strip values before any content is sent to an AI model or Markdown renderer.
  $("script,style,noscript,template,iframe,svg").remove();
  $("input,textarea").removeAttr("value");
  $("textarea").empty();
  $("[contenteditable]").empty();
  $("a[href],img[src]").each((_, el) => {
    const e = $(el);
    const attr = el.tagName === "a" ? "href" : "src";
    const value = resolveUrl(e.attr(attr) || "", base);
    if (value && !value.startsWith("data:")) e.attr(attr, value);
    else e.removeAttr(attr);
  });
  const cleanHtml = $("body").html() || "";
  let extracted = cleanHtml;
  let readable = false;
  if (content === "main") {
    const dom = new JSDOM($.html(), { url: finalUrl });
    try {
      const article = new Readability(dom.window.document).parse();
      if (
        article?.content &&
        article.textContent &&
        article.textContent.trim().length > 100
      ) {
        extracted = article.content;
        readable = true;
      }
    } finally {
      dom.window.close();
    }
  }
  const markdown = new Turndown({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  }).turndown(extracted);
  return {
    title,
    description,
    canonical,
    language,
    openGraph,
    headings,
    links,
    forms,
    markdown,
    images: dedupeImages(candidates),
    readable,
  };
}
export function looksLikeShell(html: string) {
  const $ = cheerio.load(html);
  $("script,style,noscript").remove();
  return (
    $("body").text().trim().length < 180 &&
    /<script\b/i.test(html) &&
    /id=["'](?:root|app|__next)|enable javascript|loading/i.test(html)
  );
}
export function looksLikeAccessBlock(html: string) {
  const $ = cheerio.load(html.slice(0, 150000));
  const title = $("title").text().trim();
  return /^(access denied|attention required|just a moment|verify (?:you are|you're) human|request blocked|captcha challenge)\b/i.test(
    title,
  );
}
