import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { fixture } from "./fixture.js";

test("studio loading, extraction tabs, gallery, exports, history, and mobile layout", async () => {
  const { server: fixtureServer, url } = await fixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "context-ui-"));
  const app = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "3101",
      DATA_DIR: dir,
      ALLOW_LOCAL_TARGETS: "true",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let serverError = "";
  app.stderr.on("data", (chunk) => {
    serverError += chunk.toString();
  });
  const browser = await chromium.launch({ headless: true });
  const out = path.join(process.env.DATA_DIR || dir, "ui-qa");
  fs.mkdirSync(out, { recursive: true });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        if ((await fetch("http://127.0.0.1:3101/api/health")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(ready, serverError || "UI test server did not start");
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1000 },
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:3101");
    await page
      .getByRole("heading", { name: "Extraction studio", exact: true })
      .waitFor();
    await page.screenshot({
      path: path.join(out, "studio-desktop.png"),
      fullPage: true,
    });
    await page.getByRole("textbox", { name: "Page URL" }).fill(url);
    await page.screenshot({
      path: path.join(out, "studio-focus.png"),
      fullPage: true,
    });
    await page
      .locator(".output-chip")
      .filter({ hasText: "Screenshot" })
      .click();
    await page
      .getByRole("button", { name: "Extract page", exact: true })
      .click();
    await page.locator(".running-panel").waitFor();
    assert.ok(
      await page
        .getByRole("button", { name: "Cancel", exact: true })
        .isVisible(),
    );
    await page.screenshot({
      path: path.join(out, "studio-loading.png"),
      fullPage: true,
    });
    await page
      .getByRole("tab", { name: "Overview", exact: true })
      .waitFor({ timeout: 60000 });
    assert.ok(
      await page
        .getByRole("heading", { name: "Extraction fixture" })
        .isVisible(),
    );
    await page.screenshot({
      path: path.join(out, "studio-results.png"),
      fullPage: true,
    });
    await page.getByRole("tab", { name: /Forms/ }).click();
    assert.ok(await page.getByText("Full name", { exact: true }).isVisible());
    assert.equal(
      await page
        .locator("main")
        .getByText("DO_NOT_COLLECT", { exact: true })
        .count(),
      0,
    );
    await page.getByRole("tab", { name: /Images/ }).click();
    await page.locator(".image-preview img").first().waitFor();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll(".image-preview img")).some(
        (el) => (el as HTMLImageElement).naturalWidth > 0,
      ),
    );
    await page.screenshot({
      path: path.join(out, "studio-images.png"),
      fullPage: true,
    });
    await page.getByRole("checkbox", { name: "Select visible" }).check();
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: /Selected ZIP/ }).click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), "images.zip");
    await download.saveAs(path.join(out, "images.zip"));
    assert.ok(fs.statSync(path.join(out, "images.zip")).size > 100);
    await page.getByRole("tab", { name: "Screenshot", exact: true }).click();
    assert.ok(await page.getByAltText("Captured page screenshot").isVisible());
    await page.getByRole("tab", { name: "HTML", exact: true }).click();
    assert.ok(
      await page.getByText("Raw response HTML", { exact: true }).isVisible(),
    );
    assert.ok(await page.locator("pre.code").textContent());
    await page.getByRole("button", { name: /History/ }).click();
    assert.ok(
      await page
        .getByRole("heading", { name: "Extraction history" })
        .isVisible(),
    );
    await page.locator(".table-link").first().click();
    await page.getByRole("tab", { name: "Overview", exact: true }).waitFor();
    await page
      .locator(".ant-message-notice")
      .last()
      .waitFor({ state: "hidden", timeout: 6000 })
      .catch(() => {});
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(out, "studio-mobile.png"),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
      "Mobile layout must not overflow horizontally",
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    app.kill("SIGTERM");
    fixtureServer.closeAllConnections();
    await new Promise<void>((r) => fixtureServer.close(() => r()));
    await new Promise((r) => setTimeout(r, 1200));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
