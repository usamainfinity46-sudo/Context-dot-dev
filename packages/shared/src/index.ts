export type CaptureMode = "auto" | "http" | "browser";
export interface Options {
  mode: CaptureMode;
  content: "main" | "full";
  outputs: ("markdown" | "html" | "images" | "screenshot" | "json")[];
  viewport: "desktop" | "mobile";
  fullPage: boolean;
  waitFor: string;
  delay: number;
  scroll: boolean;
  fields: string;
  schema?: Record<string, unknown>;
  maxPages: number;
  maxDepth: number;
  include: string;
  exclude: string;
  sameOrigin: boolean;
}
export interface ImageCandidate {
  id: string;
  url: string;
  alt: string;
  width?: number;
  height?: number;
  types: string[];
  status: "candidate" | "downloaded" | "failed";
  file?: string;
  mime?: string;
  error?: string;
}
export interface PageResult {
  url: string;
  finalUrl: string;
  capturedAt: string;
  durationMs: number;
  mode: "http" | "browser";
  modeReason: string;
  title: string;
  description: string;
  canonical: string;
  language: string;
  openGraph: Record<string, string>;
  headings: { level: number; text: string }[];
  links: { url: string; text: string; internal: boolean }[];
  forms: {
    action: string;
    method: string;
    fields: {
      label: string;
      name: string;
      type: string;
      placeholder: string;
      required: boolean;
      options?: { text: string; value: string }[];
    }[];
  }[];
  markdown: string;
  rawHtml?: string;
  renderedHtml?: string;
  images: ImageCandidate[];
  screenshot?: string;
  structured?: unknown;
  warnings: string[];
}
export interface Job {
  id: string;
  url: string;
  kind: "scrape" | "map" | "crawl";
  options: Options;
  status:
    | "queued"
    | "running"
    | "completed"
    | "partial"
    | "failed"
    | "cancelled"
    | "interrupted";
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: string;
  error?: string;
  result?: PageResult;
  pages?: PageResult[];
  discovered?: { url: string; depth: number; source: string; error?: string }[];
}
