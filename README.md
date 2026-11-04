# Context Local

A personal web extraction studio. React, Ant Design, Express, Playwright, Cheerio, Readability, Turndown, SQLite, and a small in-process runner. No accounts or external queue services.

## One-command setup on Mac

With **Docker Desktop running**, clone this repository, open its folder in Terminal, and run:

```sh
docker compose up --build -d
```

Open **http://localhost:3100**. That is the entire setup. No local Node, pnpm, database, browser installation, or `.env` file is required. The first build downloads Chromium and dependencies; allow several minutes. The image builds natively on Intel and Apple Silicon using the official multi-architecture Node Debian image. Mac hardware still needs a local verification; development verification was performed with Linux containers on Windows Docker Desktop.

```sh
docker compose logs -f app          # server logs
docker compose down                 # stop; keeps data
docker compose up -d                # start again
docker compose up --build -d         # rebuild after pulling changes
```

## Using the studio

Paste a URL, choose Scrape page, select outputs, and extract. Auto fetches HTTP first, then uses Chromium only when a successful page looks like an empty JavaScript shell or a browser capability is requested. HTTP never silently switches to Chromium. Blocked requests are reported without automatic retries.

- **Overview:** metadata, document outline, timing, actual capture mode and reason.
- **Markdown:** sanitized preview or source; main article and full-page content are separate options. When Readability cannot find a reliable article, cleaned full-page content is used with a notice.
- **HTML:** response source and rendered DOM are explicitly separate. Source is escaped code, never executable HTML.
- **Images:** responsive and lazy candidates, CSS backgrounds, social images, icons, posters, SVGs, data URIs. Filter by source and known dimensions; download individually or in selected/all ZIPs. Candidate discovery does not guarantee an image will download. Each failure remains visible.
- **Screenshot:** desktop/mobile, viewport/full page, bounded lazy scrolling, selector and delay controls.
- **JSON:** optional AI output with server-side credentials and Ajv validation against an inline JSON Schema. Missing facts must be null. Model output is displayed separately from locally extracted metadata.
- **Links / Forms:** internal/external links and form structure, including select options. The form extractor does not collect entered values.
- **Map URLs:** discovers sitemap and link URLs, bounded by page count, depth, path filters, origin, and robots.txt. Select URLs and use Scrape selected to create a crawl job.
- **Crawl site:** extracts multiple pages directly. Default 20 pages, depth 2, concurrency 2. Each page has its own results.
- **History:** reopen persisted results or delete jobs and generated files. Exports include Markdown, JSON, raw/rendered HTML, screenshots, image ZIPs and complete bundles. Download images first to include their bytes in the complete bundle.

## Optional configuration

Copy `.env.example` to `.env` only if you want AI or private development targets. Compose reads it automatically.

```dotenv
OPENAI_API_KEY=your-key
OPENAI_MODEL=gpt-4.1-mini
ALLOW_LOCAL_TARGETS=false
```

Re-run `docker compose up -d` after changing `.env`. Keys remain on the backend and are never returned to the browser. AI-selected content is sent to OpenAI; other extraction features work without credentials. No live billable model call is made by the tests.

Private/loopback/link-local destinations are rejected by default, including redirects and Chromium subrequests. DNS answers are validated and pinned to each HTTP connection. To scrape **your own local development app**, explicitly set `ALLOW_LOCAL_TARGETS=true` and use `http://host.docker.internal:YOUR_PORT` inside Docker. This broad opt-in permits private destinations; keep it off for ordinary use. Cloud metadata destinations remain blocked.

The app is published only on your machine's loopback address. Inside Docker the process listens on `0.0.0.0` so the loopback-published port works. Native operation binds `127.0.0.1` by default. Requests using unexpected Host or Origin headers are rejected. Do not publish this personal, unauthenticated app on a public network.

## Data and backups

Compose creates the **context-data** named Docker volume automatically (typically `<folder>_context-data`). Inside the container:

```text
/app/data/context.sqlite             job records, options, results, errors
/app/data/files/<generated-job-id>/   screenshots and downloaded images
```

The database uses WAL. Queued/running jobs are marked interrupted on restart; run them again explicitly. No stuck running records or automatic replay. Local screenshot/image filenames are generated; user paths are never used. History shows the latest 200 jobs. Stop the app before making a full-volume backup. `docker compose down` preserves the volume; deleting the volume erases your history and files.

## Development and checks in Docker

Everything can run inside the app container:

```sh
docker compose exec app pnpm typecheck
docker compose exec app pnpm test
docker compose exec app pnpm test:integration
docker compose exec app pnpm test:ui
docker compose exec app pnpm build
```

Integration tests start temporary local fixture servers in the container and explicitly enable local-target access **only in that test process**. They cover HTTP, real Chromium rendering, a lazy image, forms, screenshots, Auto shell fallback, access blocks, redirect protection, and robots-aware discovery. Unit tests cover resolution, deduplication, target validation, API and JSON Schema validation, restart recovery, and cancellation.

For native development (optional): Node 22+, `corepack enable`, `pnpm install`, `pnpm --filter server exec playwright install --with-deps chromium`, then `pnpm dev`. UI: http://localhost:5173; API: http://127.0.0.1:3100. Run `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, and `pnpm build`. Native data defaults to the repository's `data/` directory; `DATA_DIR` is relative to the server working directory. `apps/web` contains UI components/styles, `apps/server/src` separates extraction, transport, persistence, crawl, AI, and API code, and `packages/shared` contains shared TypeScript types.

## Bounds and limitations

- HTML: 12 MiB per response. Image: 15 MiB per download. HTTP: 25-second timeout and 5 redirects. Browser: 90-second context deadline, 350 requests, 100 MiB total transfer, 6 scroll steps. Screenshot height is clipped at 20,000 px. Up to 300 image candidates per page.
- At most two jobs run at once; each crawl uses two workers and has no retries. The queue holds up to 20 waiting jobs. Crawls are small and deliberate (100-page hard cap, depth 5). Requests to robots.txt fail closed except 404. Sitemap discovery supports up to 8 uncompressed XML sitemap documents, one index level, and a bounded URL set; it is not an exhaustive large-site mapper.
- Browser requests are served through the validated HTTP transport. WebSockets, service workers, and non-GET requests are disabled. Apps requiring login, POST data, streaming, CAPTCHA, private session cookies, or special browser transport may not render fully. There is no stealth, proxy, or bypass infrastructure.
- Main content uses article heuristics; use Full page for forms and application content. Form structure is extracted independently. Raw HTML, screenshots, and page text can still contain personal information already displayed by a target page; keep your local data private.
- Dimensions come from markup or browser `naturalWidth`/`naturalHeight`; unknown dimensions are excluded when minimum-size filters are set. External stylesheets contribute computed backgrounds in Browser mode; HTTP mode discovers inline/style-tag CSS. SVG markup is never injected into the UI and SVGs are download-only. Image data URLs and HTTP sources are bounded.
- JSON Schema supports inline draft-07-compatible schemas (Ajv + formats). Remote/local `$ref` references and recursive schemas are rejected, with a 30 KB schema limit. Model requests use JSON-object mode and then local validation; use an object at the schema root, with arrays nested inside it if needed. A model may still fail validation, which is shown as a partial result. Content over 100,000 characters is truncated for the model. See the [official OpenAI documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat) for the distinction between JSON mode and model-enforced schemas.
- Cancellation stops page work and network requests; already saved partial crawl pages remain available. Image download batches have bounded requests but are separate from the extraction runner. JavaScript-shell detection is heuristic; choose Browser explicitly when Auto misses a dynamic page.
- Tests do not promise compatibility with arbitrary websites. Access restrictions and unsupported content are surfaced directly. No external site's full content is logged.

The interface follows the supplied `UI Examples` references using compact [Ant Design components](https://ant.design/components/overview/), neutral colors, and restrained blue accents. Browser setup follows [Playwright's installation guidance](https://playwright.dev/docs/browsers). Crawlee supplies the local queue and bounded crawl runner.
