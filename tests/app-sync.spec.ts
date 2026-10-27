import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/rendered.json", import.meta.url), "utf8"));

test("split mode syncs front matter and nested or collapsed callouts after metadata edits", async ({ page }) => {
  const source: string = fixtures.samples.sync_callouts;
  const updated: string = fixtures.samples.sync_callouts_updated;
  await page.addInitScript(({ source, updated, initial, next }) => {
    const appWindow = window as any;
    appWindow.isTauri = true;
    appWindow.renderedSources = [];
    let callback = 0;
    appWindow.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: () => ++callback,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        if (command === "read_recovery") return [{ name: "callouts.md", text: source, base: source, dirty: true }];
        if (command === "renderer_info") return { versions: { zensical: "test" } };
        if (command !== "render_markdown") return null;
        appWindow.renderedSources.push(args.text);
        if (args.text === source) return initial;
        if (args.text === updated) return next;
        throw new Error("Missing sync renderer fixture");
      },
    };
  }, { source, updated, initial: fixtures.results.sync_callouts, next: fixtures.results.sync_callouts_updated });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('[data-mode="split"]').click();
  const frame = page.frameLocator("#preview-content iframe");
  const content = page.locator(".tab-editor:not([hidden]) .cm-content");
  const properties = frame.locator(".znote-document-properties > details");
  await expect(properties).toBeVisible();
  await frame.locator("h1").evaluate(element => { (window as any).retainedHeading = element; });

  // Edit only the metadata length: the renderer returns identical HTML/meta.
  await content.focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as any).renderedSources.at(-1))).toBe(updated);
  await expect.poll(() => frame.locator("h1").evaluate(element => element === (window as any).retainedHeading)).toBe(true);
  await page.keyboard.press("Control+End");
  await expect(frame.getByText("After 39", { exact: true })).toBeInViewport();
  await page.keyboard.press("Control+Home");
  await expect(properties.locator(":scope > summary")).toBeInViewport();
  await expect(properties).not.toHaveAttribute("open");
  await properties.locator(":scope > summary").click();
  await content.focus();
  await page.keyboard.press("Control+End");
  await expect(frame.getByText("After 39", { exact: true })).toBeInViewport();
  await page.keyboard.press("Control+Home");
  await expect(properties.locator(":scope > summary")).toBeInViewport();
  await expect(properties).toHaveAttribute("open");

  const outer = frame.locator("article > .admonition.note:has(> .admonition.tip)");
  const paragraphs = [outer.locator(":scope > p:not(.admonition-title)").first(),
    outer.locator(":scope > .admonition.tip > p:not(.admonition-title)"),
    outer.locator(":scope > p:not(.admonition-title)").last()];
  const lines = updated.split("\n").flatMap((text, i) => text.includes("重复段落。") ? [i + 1] : []);
  const scroller = page.locator(".tab-editor:not([hidden]) .cm-scroller");
  for (let i = 0; i < paragraphs.length; i++) {
    await paragraphs[i].evaluate(element => {
      document.dispatchEvent(new WheelEvent("wheel", { deltaY: 1 }));
      window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - document.documentElement.clientHeight * .28 + 1);
    });
    const lineText = updated.split("\n")[lines[i] - 1];
    const editorLine = page.locator(".tab-editor:not([hidden]) .cm-line").filter({ hasText: new RegExp("^" + lineText + "$") });
    // Two outer paragraphs share source text; the reading margin distinguishes them.
    await expect.poll(async () => {
      const top = (await scroller.boundingBox())!.y + await scroller.evaluate(el => el.clientHeight * .28);
      return editorLine.evaluateAll((elements, top) => Math.min(...elements.map(el => Math.abs(el.getBoundingClientRect().top - top))), top);
    }).toBeLessThan(10);
  }

  const collapsed = frame.locator("details.warning");
  await collapsed.locator("summary").evaluate(element => {
    document.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
    window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - document.documentElement.clientHeight * .28 + 1);
  });
  await expect(page.locator(".tab-editor:not([hidden]) .cm-line").filter({ hasText: "> [!warning]- 收起的提示" })).toBeInViewport();
  await expect(collapsed.locator("p")).toBeHidden();
  // Reverse sync moves only the editor viewport, preserving the cursor.
  await expect(page.locator("#cursor-position")).toContainText("行 1");
});

test("split mode follows editor scrolling in both directions without moving the cursor or bouncing", async ({ page }) => {
  const source = Array.from({ length: 120 }, (_, i) => `paragraph ${i}`).join("\n\n");
  await page.addInitScript(source => {
    const appWindow = window as any;
    appWindow.isTauri = true;
    let callback = 0;
    appWindow.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: () => ++callback,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        if (command === "read_recovery") return [{ name: "scroll.md", text: source, base: source, dirty: true }];
        if (command === "renderer_info") return { versions: { zensical: "test" } };
        if (command !== "render_markdown") return null;
        let offset = 0;
        const entries: any[] = [];
        const html = args.text.split("\n\n").map((text: string, i: number) => {
          entries.push({ id: String(i), kind: "p", precision: "exact", from: offset, to: offset + text.length });
          offset += text.length + 2;
          return `<p data-zn-node="${i}">${text}</p>`;
        }).join("");
        return { html, toc: [], warnings: [], meta: {}, sourceMap: { version: 1, offsetEncoding: "utf-16", entries } };
      },
    };
  }, source);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('[data-mode="split"]').click();
  const frame = page.frameLocator("#preview-content iframe");
  await expect(frame.locator("p").last()).toHaveText("paragraph 119");
  const scroller = page.locator(".tab-editor:not([hidden]) .cm-scroller");
  const previewBody = frame.locator("body");
  const expectAligned = async () => {
    await expect.poll(async () => {
      const text = await scroller.evaluate(element => {
        const y = element.getBoundingClientRect().top + element.clientHeight * .28;
        const lines = Array.from(element.querySelectorAll<HTMLElement>(".cm-line"));
        return lines.filter(line => line.textContent?.startsWith("paragraph "))
          .sort((a, b) => Math.abs(a.getBoundingClientRect().top - y) - Math.abs(b.getBoundingClientRect().top - y))[0]?.textContent;
      });
      return frame.locator("p").filter({ hasText: new RegExp(`^${text}$`) }).evaluate(element =>
        Math.abs(element.getBoundingClientRect().top - document.documentElement.clientHeight * .28));
    }).toBeLessThan(35);
  };
  await scroller.hover();
  await page.mouse.wheel(0, 1600);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(1000);
  await expectAligned();
  await expect(page.locator("#cursor-position")).toContainText("行 1");

  // Preview-driven scrolling must not be echoed back as editor input.
  await previewBody.hover();
  await page.mouse.wheel(0, 900);
  await expectAligned();
  const previewTop = await previewBody.evaluate(() => window.scrollY);
  await page.waitForTimeout(350);
  expect(await previewBody.evaluate(() => window.scrollY)).toBeCloseTo(previewTop, 0);

  // Scrolling the editor takes control again, without requiring a cursor move.
  await scroller.hover();
  await page.mouse.wheel(0, -700);
  await expectAligned();
  await expect(page.locator("#cursor-position")).toContainText("行 1");

  await page.locator('[data-action="settings"]').first().click();
  await page.locator('[data-settings-tab="writing"]').click();
  await page.locator("#sync-preview").uncheck();
  await page.locator("#modal-root [data-dismiss]").last().click();
  const disabledTop = await previewBody.evaluate(() => window.scrollY);
  await scroller.hover();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(350);
  expect(await previewBody.evaluate(() => window.scrollY)).toBeCloseTo(disabledTop, 0);
});

test("appearance settings update preview without a renderer request", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("znote:preferences");
    const appWindow = window as any;
    appWindow.isTauri = true;
    appWindow.renderRequests = 0;
    let callback = 0;
    appWindow.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: () => ++callback,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        if (command === "read_recovery") return [{ name: "style.md", text: "# Style", base: "# Style", dirty: true }];
        if (command === "renderer_info") return { versions: { zensical: "test" } };
        if (command !== "render_markdown") return null;
        appWindow.renderRequests++;
        return {
          html: "<h1>Style</h1><p>Body text</p>", toc: [], warnings: [], meta: {},
          effectiveConfig: args.includeEffectiveConfig ? args.settings : undefined,
          plan: { schemaVersion: 4, math: args.settings.math, mermaid: args.settings.mermaid,
            features: args.settings.features, runtimes: [], styles: [],
            revisions: { parse: "parse", runtime: "runtime" } },
        };
      },
    };
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('[data-mode="split"]').click();
  const article = page.frameLocator("#preview-content iframe").locator("article");
  await expect(article).toContainText("Style");
  await article.evaluate(element => {
    (element.ownerDocument.defaultView as any).originalHeading = element.querySelector("h1");
  });
  await page.locator('[data-action="settings"]').first().click();
  await expect(page.frameLocator("#settings-preview iframe").locator("article")).toContainText("Style");
  const requests = await page.evaluate(() => (window as any).renderRequests);
  const scroller = page.locator(".tab-editor:not([hidden]) .cm-scroller");
  const paragraph = article.locator("p");
  const sample = page.frameLocator("#settings-preview iframe").locator("p");
  await expect(scroller).toHaveCSS("font-size", "17px");
  await expect(paragraph).toHaveCSS("font-size", "17px");
  await page.getByLabel("编辑区字号", { exact: true }).fill("21");
  await expect(scroller).toHaveCSS("font-size", "21px");
  await expect(paragraph).toHaveCSS("font-size", "17px");
  await expect(sample).toHaveCSS("font-size", "17px");
  await page.getByLabel("阅读区字号", { exact: true }).fill("18");
  await expect(scroller).toHaveCSS("font-size", "21px");
  await expect(paragraph).toHaveCSS("font-size", "18px");
  await expect(sample).toHaveCSS("font-size", "18px");
  await page.locator('[data-settings-tab="advanced"]').click();
  await page.locator('[data-config="variant"]').selectOption("classic");
  await expect(page.frameLocator("#preview-content iframe").locator("body")).toHaveAttribute("data-zn-variant", "classic");
  await expect(paragraph).toHaveCSS("font-size", "18px");
  await expect(sample).toHaveCSS("font-size", "18px");
  expect(await article.evaluate(element =>
    (element.ownerDocument.defaultView as any).originalHeading === element.querySelector("h1"),
  )).toBe(true);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).renderRequests)).toBe(requests);
  await page.locator("#modal-root [data-dismiss]").last().click();
  await page.locator('[data-mode="source"]').click();
  await expect(scroller).toHaveCSS("font-size", "21px");
  await page.locator('[data-mode="read"]').click();
  await expect(paragraph).toHaveCSS("font-size", "18px");
  await page.locator('[data-action="theme"]').click();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => (window as any).renderRequests)).toBe(requests);
  await page.locator('[data-action="settings"]').first().click();
  await page.locator('[data-settings-tab="extensions"]').click();
  await page.locator('[data-extension="admonition"]').uncheck();
  await expect.poll(() => page.evaluate(() => (window as any).renderRequests)).toBeGreaterThan(requests);
});

test("native render commits respect later preview reading and cursor-only moves do not render", async ({ page }) => {
  const source = Array.from({ length: 100 }, (_, i) => "paragraph " + i).join("\n\n");
  await page.addInitScript(source => {
    const appWindow = window as any;
    appWindow.isTauri = true;
    appWindow.renderRequests = 0;
    appWindow.pendingRenders = [];
    appWindow.holdRenders = false;
    let callback = 0;
    appWindow.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: () => ++callback,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        if (command === "read_recovery") return [{ name: "sync.md", text: source, base: source, dirty: true }];
        if (command === "renderer_info") return { versions: { zensical: "test" } };
        if (command !== "render_markdown") return null;
        appWindow.renderRequests++;
        const entries: any[] = [];
        let offset = 0;
        const html = args.text.split("\n\n").map((text: string, i: number) => {
          entries.push({ id: String(i), kind: "p", precision: "exact", from: offset, to: offset + text.length });
          offset += text.length + 2;
          return `<p data-zn-node="${i}">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`;
        }).join("");
        const result = { html, toc: [], warnings: [], meta: {},
          sourceMap: { version: 1, offsetEncoding: "utf-16", entries } };
        if (!appWindow.holdRenders) return result;
        return await new Promise(resolve => appWindow.pendingRenders.push(() => resolve(result)));
      },
    };
  }, source);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('[data-mode="split"]').click();
  const frame = page.frameLocator("#preview-content iframe");
  await expect(frame.locator("p").first()).toHaveText("paragraph 0");
  await page.evaluate(() => { (window as any).holdRenders = true; });
  await page.locator(".tab-editor:not([hidden]) .cm-line").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect.poll(() => page.evaluate(() => (window as any).pendingRenders.length)).toBe(1);
  await frame.locator("body").hover();
  await page.mouse.wheel(0, 1400);
  await expect.poll(() => frame.locator("body").evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  const before = await frame.locator("body").evaluate(() => window.scrollY);
  await page.evaluate(() => {
    (window as any).holdRenders = false;
    (window as any).pendingRenders.splice(0).forEach((resolve: () => void) => resolve());
  });
  await expect(frame.locator("p").first()).toHaveText("paragraph 0!");
  await expect.poll(() => frame.locator("body").evaluate(() => window.scrollY)).toBeCloseTo(before, 0);
  await expect(page.locator("#cursor-position")).toContainText("行 1");
  const requests = await page.evaluate(() => (window as any).renderRequests);
  await page.locator(".tab-editor:not([hidden]) .cm-content").focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => (window as any).renderRequests)).toBe(requests);
});
