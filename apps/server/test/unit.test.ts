import "./setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  resolveUrl,
  normalizeUrl,
  dedupeImages,
  parsePage,
  srcsetUrls,
  looksLikeShell,
} from "../src/parse.js";
import { validateTarget, publicAddress, safeFetch } from "../src/network.js";
import {
  schemaValidator,
  optionsSchema,
  jobSchema,
} from "../src/validation.js";
import { Store } from "../src/store.js";
import { Runner } from "../src/runner.js";
import { store } from "../src/store.js";
import { pathAllowed } from "../src/crawl.js";
test("resolves relative URLs, respects document base, strips fragments, preserves query variants", () => {
  assert.equal(
    resolveUrl("../image.png?w=640#hero", "https://example.com/blog/page"),
    "https://example.com/image.png?w=640",
  );
  assert.equal(
    resolveUrl("javascript:alert(1)", "https://example.com"),
    undefined,
  );
  assert.equal(
    normalizeUrl("https://EXAMPLE.com:443/a?width=2#x"),
    "https://example.com/a?width=2",
  );
  const result = parsePage(
    '<base href="/assets/"><img src="a.png"><picture><source srcset="b.png 1x, b.png?w=2 2x"></picture>',
    "https://example.com/docs/page",
    "full",
  );
  assert.deepEqual(
    result.images.map((i) => i.url),
    [
      "https://example.com/assets/a.png",
      "https://example.com/assets/b.png",
      "https://example.com/assets/b.png?w=2",
    ],
  );
});
test("deduplication merges sources without dropping responsive variants", () => {
  const images = dedupeImages([
    { url: "https://EXAMPLE.com/a.png?w=100#x", alt: "one", types: ["img"] },
    { url: "https://example.com/a.png?w=100", alt: "", types: ["social"] },
    { url: "https://example.com/a.png?w=200", alt: "two", types: ["srcset"] },
  ]);
  assert.equal(images.length, 2);
  assert.deepEqual(images[0].types, ["img", "social"]);
  assert.equal(images[0].alt, "one");
  assert.notEqual(images[0].id, images[1].id);
  assert.deepEqual(srcsetUrls("a.png 320w, b.png 640w, c.png 2x"), [
    "a.png",
    "b.png",
    "c.png",
  ]);
});
test("collects form structure without values and preserves full-page content", () => {
  const parsed = parsePage(
    '<title>Fixture</title><form><label for="email">Email</label><input id="email" name="email" type="email" value="secret" required placeholder="Email address"><textarea>private</textarea><select name="choice"><option value="a">Alpha</option></select></form><h1>Hello</h1><a href="/next">Next</a>',
    "https://example.com",
    "full",
  );
  assert.equal(parsed.forms[0].fields[0].label, "Email");
  assert.equal(parsed.forms[0].fields[0].required, true);
  assert.ok(!JSON.stringify(parsed.forms).includes("secret"));
  assert.ok(!parsed.markdown.includes("private"));
  assert.equal(parsed.forms[0].fields[2].options?.[0].value, "a");
  assert.equal(parsed.links[0].internal, true);
});
test("rejects non-public targets, metadata, obfuscated IPs and unsupported schemes", async () => {
  for (const url of [
    "file:///etc/passwd",
    "ftp://example.com",
    "http://127.0.0.1",
    "http://2130706433",
    "http://0x7f000001",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "http://10.0.0.1",
    "http://172.16.0.1",
    "http://192.168.1.1",
    "http://169.254.169.254",
    "http://100.64.0.1",
  ])
    await assert.rejects(validateTarget(url, false));
  await assert.rejects(validateTarget("http://169.254.169.254", true));
  await assert.rejects(validateTarget("https://user:pass@example.com", true));
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("fe80::1"), false);
  assert.equal(publicAddress("fc00::1"), false);
  assert.equal(
    (await validateTarget("http://127.0.0.1", true)).addresses[0].address,
    "127.0.0.1",
  );
});
test("API input validation and actual JSON Schema validation", () => {
  assert.throws(() =>
    optionsSchema.parse({ mode: "http", outputs: ["screenshot"] }),
  );
  assert.throws(() => optionsSchema.parse({ delay: 6000 }));
  assert.throws(() => jobSchema.parse({ url: "bad" }));
  const validate = schemaValidator({
    type: "object",
    properties: { price: { type: ["number", "null"] } },
    required: ["price"],
    additionalProperties: false,
  });
  assert.equal(validate({ price: null }), true);
  assert.equal(validate({ price: "unknown" }), false);
  assert.equal(validate({}), false);
  assert.throws(() =>
    schemaValidator({
      type: "object",
      properties: { foo: { $ref: "http://evil/schema" } },
    }),
  );
  assert.throws(() => schemaValidator({ type: "nonexistent" }));
});
test("restart marks queued and running jobs interrupted and retains terminal jobs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "context-store-"));
  let local = new Store(dir);
  const options = optionsSchema.parse({});
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const [i, status] of (
    ["queued", "running", "completed"] as const
  ).entries())
    local.save({
      id: ids[i],
      url: "https://example.com",
      kind: "scrape",
      options,
      status,
      createdAt: new Date().toISOString(),
      progress: "",
    });
  local.db.close();
  local = new Store(dir);
  assert.equal(local.get(ids[0])?.status, "interrupted");
  assert.equal(local.get(ids[1])?.status, "interrupted");
  assert.equal(local.get(ids[2])?.status, "completed");
  assert.ok(local.get(ids[1])?.finishedAt);
  assert.throws(() => local.jobDir("../escape"));
  local.remove(ids[0]);
  assert.equal(local.get(ids[0]), undefined);
  local.db.close();
  fs.rmSync(dir, { recursive: true });
});
test("queued job cancellation prevents execution and persists lifecycle", () => {
  const runner = new Runner();
  runner.active.set("slot-1", new AbortController());
  runner.active.set("slot-2", new AbortController());
  const job = runner.create(
    "https://example.com",
    "scrape",
    optionsSchema.parse({}),
  );
  assert.equal(store.get(job.id)?.status, "queued");
  assert.equal(runner.cancel(job.id), true);
  assert.equal(store.get(job.id)?.status, "cancelled");
  assert.equal(runner.pending.length, 0);
  assert.equal(runner.cancel(job.id), false);
  store.remove(job.id);
});
test("shell detection and crawl path filters", () => {
  assert.equal(
    looksLikeShell('<div id="root"></div><script src="/a.js"></script>'),
    true,
  );
  assert.equal(
    looksLikeShell(
      "<h1>Article</h1><p>" +
        "A real article. ".repeat(50) +
        "</p><script></script>",
    ),
    false,
  );
  assert.equal(
    pathAllowed("https://example.com/docs/hello", "/docs", "/login"),
    true,
  );
  assert.equal(
    pathAllowed("https://example.com/docs/login", "/docs", "/login"),
    false,
  );
});
