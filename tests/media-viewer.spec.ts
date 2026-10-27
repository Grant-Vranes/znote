import { test, expect } from "@playwright/test";

async function mount(page: import("@playwright/test").Page, kind: "image" | "pdf", path: string) {
  await page.goto("/tests/media-viewer.html");
  return page.evaluate(async ([fileKind, filePath]) => {
    try {
      const { MediaViewer } = await import("/src/media-viewer.ts");
      (window as any).savedMedia = [];
      (window as any).mediaViewer = new MediaViewer(
        document.querySelector("#host"),
        { path: filePath, name: filePath.split(/[\\/]/).pop(), kind: fileKind },
        { saveAs: async () => (window as any).savedMedia.push(filePath) },
      );
      return "ready";
    } catch (error) {
      return String(error);
    }
  }, [kind, path]);
}

test("image viewer uses a restricted local URL and exposes read-only view controls", async ({ page }) => {
  expect(await mount(page, "image", "C:/Notes/中文 cover #1.png")).toBe("ready");
  const image = page.locator(".media-image");
  await expect(image).toHaveAttribute("src", /^local-media:\/\/localhost\/[A-Za-z0-9_-]+$/);
  await expect(image).toHaveAttribute("alt", "中文 cover #1.png");
  await expect(page.locator(".media-toolbar button")).toHaveCount(6);
  await expect(page.locator("[contenteditable='true']")).toHaveCount(0);
  await page.getByRole("button", { name: "放大" }).click();
  await expect(image).toHaveCSS("transform", "matrix(1.25, 0, 0, 1.25, 0, 0)");
  await page.getByRole("button", { name: "旋转" }).click();
  await expect(image).toHaveCSS("transform", "matrix(0, 1.25, -1.25, 0, 0, 0)");
  await page.getByRole("button", { name: "实际大小" }).click();
  await expect(image).toHaveCSS("transform", "matrix(0, 1, -1, 0, 0, 0)");
  await page.getByRole("button", { name: "适配" }).click();
  await page.getByRole("button", { name: "另存为" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).savedMedia)).toEqual(["C:/Notes/中文 cover #1.png"]);
});

test("PDF viewer delegates navigation and zoom to Chromium's built-in viewer", async ({ page }) => {
  expect(await mount(page, "pdf", "C:/Notes/guide.pdf")).toBe("ready");
  await expect(page.locator("iframe.pdf-document")).toHaveAttribute("src", /^local-media:\/\/localhost\/[A-Za-z0-9_-]+$/);
  await expect(page.locator(".media-toolbar button")).toHaveCount(0);
  await expect(page.locator(".media-image")).toHaveCount(0);
});
