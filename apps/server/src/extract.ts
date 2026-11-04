import path from "node:path";
import type { Options, PageResult } from "@context/shared";
import { safeFetch, requireHtml } from "./network.js";
import { parsePage, looksLikeShell, looksLikeAccessBlock } from "./parse.js";
import { captureBrowser } from "./browser.js";
import { structuredExtract } from "./ai.js";
export async function extract(
  url: string,
  options: Options,
  dir: string,
  signal: AbortSignal,
  progress: (s: string) => void,
  filePrefix = "page",
  beforeRequest?: (url: string) => Promise<void>,
): Promise<PageResult> {
  const start = Date.now();
  const warnings: string[] = [];
  let rawHtml: string | undefined,
    renderedHtml: string | undefined,
    finalUrl = url;
  let mode: "http" | "browser" = "http",
    modeReason = "HTTP selected: direct response capture.";
  let screenshot: string | undefined;
  let extras: Parameters<typeof parsePage>[3] = [];
  const browserRequired =
    options.mode === "browser" ||
    (options.mode === "auto" &&
      (options.outputs.includes("screenshot") || !!options.waitFor));
  if (!browserRequired) {
    progress("Fetching response HTML");
    const response = await safeFetch(url, { signal, beforeRequest });
    requireHtml(response);
    rawHtml = response.body.toString("utf8");
    finalUrl = response.url;
    modeReason =
      options.mode === "auto"
        ? "Auto used HTTP: the response contained page content."
        : modeReason;
  }
  if (rawHtml && looksLikeAccessBlock(rawHtml))
    throw new Error(
      "This page appears to be an access challenge. No browser escalation, retries, or bypass were attempted.",
    );
  const shell = options.mode === "auto" && rawHtml && looksLikeShell(rawHtml);
  if (browserRequired || shell) {
    mode = "browser";
    modeReason =
      options.mode === "browser"
        ? "Browser explicitly selected."
        : shell
          ? "Auto used Browser: successful HTTP response appeared to be a JavaScript shell."
          : "Auto used Browser: screenshot or wait-for selector requested.";
    progress("Rendering page in Chromium");
    const capture = await captureBrowser(
      finalUrl,
      options,
      path.join(dir, `${filePrefix}-screenshot.png`),
      signal,
      beforeRequest,
    );
    renderedHtml = capture.html;
    rawHtml = capture.rawHtml ?? rawHtml;
    finalUrl = capture.finalUrl;
    extras = capture.extras;
    screenshot = capture.screenshot;
    warnings.push(...capture.warnings);
  }
  signal.throwIfAborted();
  if (renderedHtml && looksLikeAccessBlock(renderedHtml))
    throw new Error(
      "The browser received an access challenge. No retries or bypass were attempted.",
    );
  progress("Parsing content, images, links, and forms");
  const { readable, ...parsed } = parsePage(
    renderedHtml ?? rawHtml ?? "",
    finalUrl,
    options.content,
    extras,
  );
  if (options.content === "main" && !readable)
    warnings.push(
      "Readability found no reliable article. Markdown uses cleaned full-page content. Forms and links are extracted separately.",
    );
  if (parsed.images.length >= 300)
    warnings.push("Image candidates capped at 300.");
  const result: PageResult = {
    ...parsed,
    url,
    finalUrl,
    capturedAt: new Date().toISOString(),
    durationMs: 0,
    mode,
    modeReason,
    rawHtml: options.outputs.includes("html") ? rawHtml : undefined,
    renderedHtml: options.outputs.includes("html") ? renderedHtml : undefined,
    screenshot,
    warnings,
  };
  if (!options.outputs.includes("images")) result.images = [];
  if (options.outputs.includes("json")) {
    progress("Extracting structured JSON");
    try {
      result.structured = await structuredExtract(
        result.markdown,
        finalUrl,
        options,
        signal,
      );
    } catch (e) {
      signal.throwIfAborted();
      warnings.push(
        e instanceof Error ? e.message : "Structured extraction failed",
      );
    }
  }
  if (
    !options.outputs.includes("markdown") &&
    !options.outputs.includes("json")
  )
    result.markdown = "";
  result.durationMs = Date.now() - start;
  return result;
}
