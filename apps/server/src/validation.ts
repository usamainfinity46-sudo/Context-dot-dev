import { z } from "zod";
import AjvImport from "ajv";
import addFormatsImport from "ajv-formats";
const Ajv = AjvImport as unknown as typeof AjvImport.default;
const addFormats =
  addFormatsImport as unknown as typeof addFormatsImport.default;
export const optionsSchema = z
  .object({
    mode: z.enum(["auto", "http", "browser"]).default("auto"),
    content: z.enum(["main", "full"]).default("main"),
    outputs: z
      .array(z.enum(["markdown", "html", "images", "screenshot", "json"]))
      .min(1)
      .default(["markdown", "html", "images"]),
    viewport: z.enum(["desktop", "mobile"]).default("desktop"),
    fullPage: z.boolean().default(true),
    waitFor: z.string().max(300).default(""),
    delay: z.number().int().min(0).max(5000).default(500),
    scroll: z.boolean().default(true),
    fields: z.string().max(6000).default(""),
    schema: z.record(z.string(), z.unknown()).optional(),
    maxPages: z.number().int().min(1).max(100).default(20),
    maxDepth: z.number().int().min(0).max(5).default(2),
    include: z.string().max(500).default(""),
    exclude: z.string().max(500).default(""),
    sameOrigin: z.boolean().default(true),
  })
  .superRefine((v, c) => {
    if (v.mode === "http" && v.outputs.includes("screenshot"))
      c.addIssue({
        code: "custom",
        message: "Screenshots require Auto or Browser mode.",
      });
    if (v.mode === "http" && v.waitFor)
      c.addIssue({
        code: "custom",
        message: "Wait-for selectors require Auto or Browser mode.",
      });
  });
export const jobSchema = z.object({
  url: z.url().max(4096),
  kind: z.enum(["scrape", "map", "crawl"]).default("scrape"),
  options: optionsSchema.default(() => optionsSchema.parse({})),
  urls: z.array(z.url().max(4096)).max(100).optional(),
});
export function schemaValidator(schema: Record<string, unknown>) {
  // Remote references and recursive schemas are intentionally unavailable for local extraction.
  const serialized = JSON.stringify(schema);
  if (serialized.length > 30000) throw new Error("JSON Schema exceeds 30 KB.");
  const walk = (value: unknown, depth = 0) => {
    if (depth > 30) throw new Error("JSON Schema nesting exceeds 30 levels.");
    if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value)) {
        if (k === "$ref" || k === "$dynamicRef")
          throw new Error(
            "JSON Schema references are not supported; use an inline schema.",
          );
        walk(v, depth + 1);
      }
  };
  walk(schema);
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateFormats: true,
  });
  addFormats(ajv);
  return ajv.compile(schema);
}
