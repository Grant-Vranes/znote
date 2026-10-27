import { test, expect } from "@playwright/test";

async function mount(page: import("@playwright/test").Page, options: { path: string; source: string; initialMode: "source" | "rendered"; allowSave?: boolean }) {
  await page.goto("/tests/html-file-viewer.html");
  return page.evaluate(async (viewerOptions) => {
    try {
      (window as any).api = { secret: "must not be visible to the document" };
      (window as any).htmlChanges = [];
      (window as any).htmlSaves = 0;
      const { HtmlViewer } = await import("/src/html-viewer.ts");
      (window as any).htmlViewer = new HtmlViewer(
        document.querySelector("#host"),
        {
          ...viewerOptions,
          onModeChange: (mode: string) => ((window as any).htmlMode = mode),
          onSourceChange: (text: string) => (window as any).htmlChanges.push(text),
          save: async () => { (window as any).htmlSaves++; return viewerOptions.allowSave !== false; },
        },
      );
      return "ready";
    } catch (error) {
      return String(error);
    }
  }, options);
}

test("rendered HTML is loaded in a sandbox without same-origin access", async ({ page }) => {
  expect(await mount(page, {
    path: "C:/docs/a #?.html", source: "<h1>safe</h1>", initialMode: "rendered",
  })).toBe("ready");
  const frame = page.locator("iframe.html-document");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-popups allow-forms");
  await expect(frame).not.toHaveAttribute("sandbox", /allow-same-origin/);
  await expect(frame).toHaveAttribute("src", /^local-html:\/\/localhost\/[A-Za-z0-9_-]+\//);
  expect(await frame.getAttribute("src")).toContain("__znote_document__.html");
});

test("switching to rendered mode saves source first and persists the selected mode", async ({ page }) => {
  expect(await mount(page, {
    path: "C:/docs/page.html", source: "<h1>before</h1>", initialMode: "source",
  })).toBe("ready");
  await page.locator(".cm-content").fill("<h1>after</h1>");
  await page.getByRole("button", { name: "渲染" }).click();
  await expect(page.locator("iframe.html-document")).toBeVisible();
  expect(await page.evaluate(() => (window as any).htmlChanges.at(-1))).toBe("<h1>after</h1>");
  expect(await page.evaluate(() => (window as any).htmlSaves)).toBe(1);
  expect(await page.evaluate(() => (window as any).htmlMode)).toBe("rendered");
  await page.getByRole("button", { name: "源码" }).click();
  await expect(page.locator(".cm-content")).toHaveText("<h1>after</h1>");
  expect(await page.evaluate(() => localStorage.getItem("znote:html-view:C:/docs/page.html"))).toBe("source");
});

test("failed source save keeps HTML in source mode", async ({ page }) => {
  expect(await mount(page, {
    path: "C:/docs/unsaved.html", source: "<p>keep me</p>", initialMode: "source", allowSave: false,
  })).toBe("ready");
  await page.getByRole("button", { name: "渲染" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.locator("iframe.html-document")).toHaveCount(0);
});

test("HTML mode defaults to source above 2 MiB regardless of a stored rendered preference", async ({ page }) => {
  await page.goto("/tests/html-file-viewer.html");
  const modes = await page.evaluate(async () => {
    const { defaultHtmlMode } = await import("/src/html-viewer.ts");
    return {
      small: defaultHtmlMode("small.html", 100, "rendered"),
      large: defaultHtmlMode("large.html", 2 * 1024 * 1024 + 1, "rendered"),
    };
  });
  expect(modes).toEqual({ small: "rendered", large: "source" });
});
