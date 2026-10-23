import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const app = window as any;
    app.isTauri = true;
    app.calls = [];
    const doc = (path: string) => ({ path, text: "# " + path, hash: "same", bom: false, eol: "LF" });
    const entry = (path: string, directory = false) => ({ path, name: path.split("/").pop(), directory, children: [] });
    const tree = (root: string) => ({ root, name: root.split("/").pop(), truncated: false, entries: root === "D:/work" ? [entry(root + "/work.md")] : root.endsWith("assets") ? [entry(root + "/picture.png")] : [entry(root + "/a.md"), entry(root + "/b.md"), entry(root + "/assets", true), entry(root + "/manual.pdf")] });
    localStorage.setItem("znote:preferences", JSON.stringify({ fileOpening: { startup: "home", mode: "source", focus: false, target: "current" } }));
    let initial = true;
    app.nextFile = "D:/other/a.md";
    app.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        app.calls.push({ command, args });
        if (command === "pending_open_requests") { const result = initial ? [{ id: 1, initial: true, source: "system" }] : []; initial = false; return result; }
        if (command === "complete_open_request") return { documents: [doc("D:/single/a.md")], errors: [] };
        if (command === "document_directory") return tree(args.document.slice(0, args.document.lastIndexOf("/")));
        if (command === "list_directory") return tree(args.path);
        if (command === "choose_workspace") return tree("D:/work");
        if (command === "choose_file") return doc(app.nextFile);
        if (command === "read_file") return doc(args.path);
        if (command === "file_hash") return "same";
        if (command === "list_recent_files") return [];
        if (command === "read_asset") return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
        if (command === "renderer_info") return { versions: { zensical: "test" } };
        return null;
      },
    };
  });
  await page.goto("/");
  await expect(page.locator('[data-directory-root="D:/single"]')).toBeVisible();
});

test("standalone folders follow files and reuse scans within a directory", async ({ page }) => {
  await page.locator('[data-file="D:/single/b.md"]').click();
  expect(await page.evaluate(() => (window as any).calls.filter((c: any) => c.command === "document_directory").length)).toBe(1);
  await page.keyboard.press("Control+o");
  await expect(page.locator('[data-directory-root="D:/other"]')).toBeVisible();
  await expect(page.locator('[data-directory-root="D:/single"]')).toHaveCount(0);
});

test("workspace stays fixed while external document directories appear and disappear", async ({ page }) => {
  await page.locator('.workspace-switch').click();
  await expect(page.locator('[data-directory-root]')).toHaveCount(2);
  await page.locator('[data-file="D:/work/work.md"]').click();
  await expect(page.locator('[data-directory-root]')).toHaveCount(1);
  await expect(page.locator('[data-directory-root="D:/work"]')).toBeVisible();
  await page.keyboard.press("Control+o");
  await expect(page.locator('[data-directory-root]')).toHaveCount(2);
  await expect(page.locator('[data-directory-root="D:/work"]')).toBeVisible();
  await expect(page.locator('[data-directory-root="D:/other"]')).toBeVisible();
});

test("attachments load on expansion and images preview without opening a note", async ({ page }) => {
  expect(await page.evaluate(() => (window as any).calls.filter((c: any) => c.command === "list_directory").length)).toBe(0);
  const folder = page.locator('[data-folder="D:/single/assets"]');
  await folder.click();
  await expect(page.locator('[data-file="D:/single/assets/picture.png"]')).toBeVisible();
  await folder.click(); await folder.click();
  expect(await page.evaluate(() => (window as any).calls.filter((c: any) => c.command === "list_directory").length)).toBe(1);
  await page.locator('[data-file="D:/single/assets/picture.png"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("#tabs .tab")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.locator('[data-file="D:/single/manual.pdf"]').click();
  expect(await page.evaluate(() => (window as any).calls.some((c: any) => c.command === "reveal_entry" && c.args.path.endsWith("manual.pdf")))).toBe(true);
});


test("slow directory results do not replace the current file directory", async ({ page }) => {
  await page.evaluate(() => {
    const app = window as any;
    const invoke = app.__TAURI_INTERNALS__.invoke;
    app.__TAURI_INTERNALS__.invoke = async (command: string, args: any) => {
      if (command === "document_directory" && args.document === "D:/slow/a.md") await new Promise(resolve => { app.releaseDirectory = resolve; });
      return invoke(command, args);
    };
    app.nextFile = "D:/slow/a.md";
  });
  await page.keyboard.press("Control+o");
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseDirectory)).toBe("function");
  await page.evaluate(() => { (window as any).nextFile = "D:/fast/a.md"; });
  await page.keyboard.press("Control+o");
  await expect(page.locator('[data-directory-root="D:/fast"]')).toBeVisible();
  await page.evaluate(() => (window as any).releaseDirectory());
  await expect.poll(() => page.evaluate(() => (window as any).calls.some((call: any) => call.command === "document_directory" && call.args.document === "D:/slow/a.md"))).toBe(true);
  await expect(page.locator('[data-directory-root="D:/fast"]')).toBeVisible();
  await expect(page.locator('[data-directory-root="D:/slow"]')).toHaveCount(0);
});
