import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { RenderResult } from "../src/types";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/rendered.json", import.meta.url), "utf8"));
const rendered: RenderResult = {
  ...(Object.values(fixtures.results)[0] as RenderResult),
  html: "<h1>正文标题</h1><p>正文内容。</p>", toc: [], sourceMap: undefined,
  meta: { title: "行走之间，落笔于此", description: "收藏日常里值得停留的微光。", date: "2026-10-10",
    authors: ["luwei"], tags: ["Zensical", "Web"], comments: true,
    social: { cards_layout_options: { title: '<img src=x onerror="alert(1)">' } } },
};

test("YAML gets syntax colors without heading underlines while body headings keep their style", async ({ page }) => {
  await page.goto("/tests/editor.html");
  await page.waitForFunction(() => !!window.editor);
  await page.evaluate(() => window.loadNote("---\ntitle: 行走之间，落笔于此\ndescription: 收藏微光。\n---\n\n正文标题\n---"));
  const title = page.locator(".cm-line").filter({ hasText: "title: 行走之间" });
  await expect(title.locator(".zn-syntax-string")).toHaveCount(1);
  expect(await title.evaluate(line => Array.from(line.querySelectorAll("span"))
    .some(span => getComputedStyle(span).textDecorationLine.includes("underline")))).toBe(false);
  const body = page.locator(".cm-line").filter({ hasText: "正文标题" });
  await expect(body.locator("span").first()).toHaveCSS("text-decoration-line", "underline");
});

test("YAML key/scalar colors stay scoped across themes and delimiter edits", async ({ page }) => {
  await page.goto("/tests/editor.html");
  await page.waitForFunction(() => !!window.editor);
  const header = '---\ntitle: YAML plain value\nquoted: "YAML quoted value"\ndescription: |\n  YAML block value\n---\n\n';
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const prefix of ["", header]) {
      await page.evaluate(source => window.loadNote(source), prefix + "Body paragraph with **bold text**.\n\n> Quoted paragraph\n\n- List paragraph");
      for (const text of ["Body paragraph", "Quoted paragraph", "List paragraph"]) {
        const line = page.locator(".cm-line").filter({ hasText: text });
        await expect(line.locator(".zn-syntax-string")).toHaveCount(0);
        expect(await line.evaluate(line => {
          const color = getComputedStyle(line.closest(".cm-content")!).color;
          // Markdown punctuation keeps its own syntax color; check prose only.
          return [line, ...line.querySelectorAll("span")]
            .filter(node => /[a-z]/i.test(node.textContent || ""))
            .every(node => getComputedStyle(node).color === color);
        })).toBe(true);
      }
      if (prefix) {
        for (const key of ["title:", "quoted:", "description:"]) {
          await expect(page.locator(".cm-line").filter({ hasText: key }).locator(".zn-syntax-selector")).toHaveCount(1);
        }
        for (const value of ["YAML plain value", "YAML quoted value", "YAML block value"]) {
          await expect(page.locator(".cm-line").filter({ hasText: value }).locator(".zn-syntax-string")).toHaveCount(1);
        }
        const title = page.locator(".cm-line").filter({ hasText: "title: YAML plain value" });
        await page.evaluate(() => window.editor.view.dispatch({ changes: { from: 0, to: 3, insert: "--" } }));
        await expect(title.locator(".zn-syntax-selector, .zn-syntax-string")).toHaveCount(0);
        await page.evaluate(() => window.editor.view.dispatch({ changes: { from: 0, to: 2, insert: "---" } }));
        await expect(title.locator(".zn-syntax-selector")).toHaveCount(1);
        await expect(title.locator(".zn-syntax-string")).toHaveCount(1);
      }
    }
  }
});

test("document properties are collapsed, safe, expandable and refresh without replacing the body", async ({ page }) => {
  await page.goto("/tests/preview.html");
  await page.waitForFunction(() => typeof (window as any).renderResult === "function");
  const source = "---\ntitle: 行走之间，落笔于此\n---\n\n# 正文标题\n\n正文内容。";
  await page.evaluate(async ({ result, source }) => {
    await (window as any).renderResult(result, source);
    (window as any).originalHeading = document.querySelector("iframe")!.contentDocument!.querySelector("h1");
  }, { result: rendered, source });
  const frame = page.frameLocator("iframe");
  const panel = frame.locator(".znote-document-properties");
  const root = panel.locator(":scope > details");
  await expect(root).not.toHaveAttribute("open");
  await expect(panel.locator("dl")).toBeHidden();
  await expect(frame.locator("h1")).toHaveCount(1);
  await root.locator(":scope > summary").click();
  await expect(panel.locator("dl")).toBeVisible();
  await expect(panel.locator(".znote-property-tokens > span")).toHaveText(["luwei", "Zensical", "Web"]);
  const nested = panel.locator('details[data-property-key="social"]');
  await nested.locator("summary").click();
  expect(JSON.parse(await nested.locator("pre").innerText())).toEqual(rendered.meta.social);
  await expect(panel.locator("img, script")).toHaveCount(0);
  expect(await page.evaluate(source => (window as any).getPreviewTarget(source, 5), source))
    .toMatchObject({ text: "正文标题", line: 5 });
  // A real body update must preserve the same live panel, not just its values.
  await page.evaluate(async result => {
    const doc = document.querySelector("iframe")!.contentDocument!;
    const panel = doc.querySelector(".znote-document-properties")!;
    (window as any).originalPanel = panel;
    let detached = false;
    const observer = new MutationObserver(records => {
      if (records.some(record => Array.from(record.removedNodes).includes(panel))) detached = true;
    });
    observer.observe(panel.parentNode!, { childList: true });
    await (window as any).renderResult({ ...result, html: result.html + '<p>New body paragraph</p>' });
    const modulePath = '/src/preview.ts';
    const { setRendered } = await import(/* @vite-ignore */ modulePath);
    const controller = new AbortController();
    const pending = setRendered(doc.querySelector('article')!,
      { ...result, html: '<p>Cancelled update</p>' }, undefined, () => {}, controller.signal);
    controller.abort();
    await pending;
    if (doc.querySelector('article')!.textContent!.includes('Cancelled update'))
      throw new Error('Cancelled preview committed');
    observer.disconnect();
    if (detached) throw new Error('Reused properties detached during render preparation');
  }, rendered);
  expect(await page.evaluate(() => document.querySelector("iframe")!.contentDocument!.querySelector(".znote-document-properties") === (window as any).originalPanel)).toBe(true);
  await expect(root).toHaveAttribute("open");
  await expect(nested).toHaveAttribute("open");
  const updated = { ...rendered, meta: { ...rendered.meta, title: "修改后的标题", date: "2026-10-22" } };
  await page.evaluate(async result => (window as any).renderResult(result), updated);
  await expect(panel.locator(".znote-property-title")).toHaveText("修改后的标题");
  expect(await page.evaluate(() => document.querySelector("iframe")!.contentDocument!.querySelector(".znote-document-properties") !== (window as any).originalPanel)).toBe(true);
  await expect(panel.locator("dl")).toContainText("2026-10-22");
  await expect(root).toHaveAttribute("open");
  await expect(nested).toHaveAttribute("open");
  expect(await page.evaluate(() => document.querySelector("iframe")!.contentDocument!.querySelector("h1") === (window as any).originalHeading)).toBe(true);
  await page.evaluate(() => (window as any).setPreviewLanguage("en"));
  await expect(root.locator(":scope > summary")).toContainText("Document properties");
  await expect(panel.locator(".znote-property-title")).toHaveText("修改后的标题");
  await page.evaluate(async result => (window as any).renderResult(result, "# 正文标题", "another-note"), updated);
  await expect(root).not.toHaveAttribute("open");
  await page.evaluate(async result => (window as any).renderResult(result), { ...rendered, meta: {} });
  await expect(panel).toHaveCount(0);
  await expect(frame.locator("h1")).toHaveText("正文标题");
});
