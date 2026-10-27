import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const app = window as any;
    app.isTauri = true;
    app.calls = [];
    const doc = (path: string) => ({ path, text: "# " + path, hash: "same", bom: false, eol: "LF" });
    const entry = (path: string, directory = false) => ({ path, name: path.split("/").pop(), directory, children: [] });
    const tree = (root: string) => ({ root, name: root.split("/").pop(), truncated: false, entries: root === "D:/work" ? [entry(root + "/work.md")] : root.endsWith("assets") ? [entry(root + "/picture.png")] : [entry(root + "/a.md"), entry(root + "/b.md"), entry(root + "/script.py"), entry(root + "/assets", true), entry(root + "/manual.pdf")] });
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
        if (command === "open_file") return {
          path: args.path,
          kind: args.path.toLowerCase().endsWith(".pdf") ? "pdf" : "image",
          size: 16,
        };
        if (command === "save_media_as") return "D:/exports/picture.png";
        if (command === "save_file") {
          if (app.conflictNextSave) {
            app.conflictNextSave = false;
            throw new Error("CONFLICT: file changed externally");
          }
          return { ...doc(args.data.path), text: args.data.text, hash: "saved" };
        }
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

test("code files open in a plain-text-capable editor tab and become dirty on edits", async ({ page }) => {
  await expect(page.locator('[data-file="D:/single/script.py"] svg.lucide-code-2')).toHaveCount(1);
  await page.locator('[data-file="D:/single/script.py"]').click();
  await expect(page.locator("#tabs .tab")).toHaveCount(2);
  await expect(page.locator(".writing-area")).toHaveAttribute("data-file-kind", "code");
  await expect.poll(() => page.locator(".tab-editor:not([hidden]) .cm-editor").getAttribute("data-language")).toBe("Python");
  await page.locator(".tab-editor:not([hidden]) .cm-content").fill("print('edited')");
  await expect(page.locator("#tabs .tab.active .dirty-dot")).toBeVisible();
});

test("code tab saves the current CodeMirror document through the host conflict-safe save command", async ({ page }) => {
  await page.locator('[data-file="D:/single/script.py"]').click();
  await page.locator(".tab-editor:not([hidden]) .cm-content").fill("print('saved code')");
  await page.locator('[data-action="save"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).calls.find((call: any) => call.command === "save_file")?.args.data.text)).toBe("print('saved code')");
  await expect(page.locator("#tabs .tab.active .dirty-dot")).toHaveCount(0);
});

test("code save conflicts preserve the in-memory editor contents", async ({ page }) => {
  await page.locator('[data-file="D:/single/script.py"]').click();
  const editor = page.locator(".tab-editor:not([hidden]) .cm-content");
  await editor.fill("print('keep this edit')");
  await page.evaluate(() => { (window as any).conflictNextSave = true; });
  await page.locator('[data-action="save"]').click();
  await expect(page.locator("#conflict-banner")).toBeVisible();
  await expect(editor).toHaveText("print('keep this edit')");
});

test("code edits are included in the native recovery snapshot", async ({ page }) => {
  await page.locator('[data-file="D:/single/script.py"]').click();
  await page.locator(".tab-editor:not([hidden]) .cm-content").fill("print('recover me')");
  await expect.poll(() => page.evaluate(() => {
    const call = (window as any).calls.findLast((item: any) => item.command === "write_recovery");
    return call?.args.documents.find((document: any) => document.path === "D:/single/script.py")?.text;
  })).toBe("print('recover me')");
});

test("closing a dirty code tab uses the shared save-or-discard prompt", async ({ page }) => {
  await page.locator('[data-file="D:/single/script.py"]').click();
  await page.locator(".tab-editor:not([hidden]) .cm-content").fill("print('discard me')");
  await page.locator("#tabs .tab.active .tab-close").click();
  await expect(page.getByRole("button", { name: "放弃更改", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "放弃更改", exact: true }).click();
  await expect(page.locator("#tabs .tab")).toHaveCount(1);
  await expect(page.locator(".tab-editor:not([hidden]) .cm-editor[data-language='Python']")).toHaveCount(0);
});

test("PDF files open in a read-only media tab instead of the external viewer", async ({ page }) => {
  await page.locator('[data-file="D:/single/manual.pdf"]').click();
  await expect(page.locator("#tabs .tab")).toHaveCount(2);
  await expect(page.locator(".writing-area")).toHaveAttribute("data-file-kind", "pdf");
  await expect(page.locator("iframe.pdf-document")).toHaveAttribute("src", /^local-media:\/\/localhost\//);
  await expect(page.locator(".save-btn")).toBeDisabled();
  const commands = await page.evaluate(() => (window as any).calls);
  expect(commands.some((call: any) => call.command === "open_file" && call.args.path.endsWith("manual.pdf"))).toBe(true);
  expect(commands.some((call: any) => call.command === "read_file" && call.args.path.endsWith("manual.pdf"))).toBe(false);
  await page.locator('[data-file="D:/single/manual.pdf"]').click();
  await expect(page.locator("#tabs .tab")).toHaveCount(2);
  await expect(page.locator("iframe.pdf-document")).toHaveCount(1);
});

test("attachments load on expansion and images open as media tabs", async ({ page }) => {
  expect(await page.evaluate(() => (window as any).calls.filter((c: any) => c.command === "list_directory").length)).toBe(0);
  const folder = page.locator('[data-folder="D:/single/assets"]');
  await folder.click();
  await expect(page.locator('[data-file="D:/single/assets/picture.png"]')).toBeVisible();
  await folder.click(); await folder.click();
  expect(await page.evaluate(() => (window as any).calls.filter((c: any) => c.command === "list_directory").length)).toBe(1);
  await page.locator('[data-file="D:/single/assets/picture.png"]').click();
  await expect(page.locator("#tabs .tab")).toHaveCount(2);
  await expect(page.locator(".writing-area")).toHaveAttribute("data-file-kind", "image");
  await expect(page.locator(".media-image")).toHaveAttribute("src", /^local-media:\/\/localhost\//);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "另存为" }).click();
  await expect(page.locator("#toasts")).toContainText("已另存为");
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
