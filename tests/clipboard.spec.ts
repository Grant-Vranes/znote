import { test, expect, type Page } from "@playwright/test";

async function desktopClipboard(page: Page, text: string, unavailable = false) {
  await page.addInitScript(({ text, unavailable }) => {
    const app = window as any;
    app.isTauri = true;
    app.clipboardReads = 0;
    app.browserClipboardReads = 0;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      readText: async () => {
        app.browserClipboardReads++;
        throw new DOMException("Read permission denied", "NotAllowedError");
      },
    } });
    app.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (command: string) => {
        if (command === "plugin:clipboard-manager|read_text") {
          app.clipboardReads++;
          if (unavailable) throw new Error("Clipboard unavailable");
          return text;
        }
        if (["pending_open_requests", "read_recovery", "list_recent_files"].includes(command)) return [];
        if (command === "renderer_info") return { versions: { zensical: "test" } };
        if (command === "render_markdown") return { html: "", toc: [], meta: {}, warnings: [] };
        return null;
      },
    };
  }, { text, unavailable });
  await page.goto("/");
  await page.getByRole("button", { name: "新建笔记", exact: true }).first().click();
  const editor = page.locator(".tab-editor:not([hidden]) .cm-content");
  await editor.fill("replace me");
  await page.keyboard.press("Control+a");
  return editor;
}

for (const name of ["粘贴", "粘贴纯文本", "粘贴为引用"]) {
  test(`desktop ${name} works when browser clipboard permission is denied`, async ({ page }) => {
    const editor = await desktopClipboard(page, "中文 😀\r\nsecond line");
    await editor.click({ button: "right", position: { x: 20, y: 10 } });
    if (name !== "粘贴") await page.getByRole("button", { name: "复制 / 粘贴为…" }).hover();
    await page.getByRole("menuitem", { name, exact: name === "粘贴" }).click();
    const lines = editor.locator(".cm-line");
    await expect(lines).toHaveText(name === "粘贴为引用"
      ? ["> 中文 😀", "> second line"] : ["中文 😀", "second line"]);
    await expect(editor).toBeFocused();
    expect(await page.evaluate(() => (window as any).browserClipboardReads)).toBe(0);
    expect(await page.evaluate(() => (window as any).clipboardReads)).toBe(1);
    await page.keyboard.press("Control+z");
    await expect(editor).toHaveText("replace me");
  });
}

test("empty clipboard does not delete the selected text", async ({ page }) => {
  const editor = await desktopClipboard(page, "");
  await editor.click({ button: "right", position: { x: 20, y: 10 } });
  await page.getByRole("menuitem", { name: "粘贴", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).clipboardReads)).toBe(1);
  await expect(editor).toHaveText("replace me");
  await expect(page.locator("#toasts [role=alert]")).toHaveCount(0);
});

test("unavailable native clipboard reports an error without changing the note", async ({ page }) => {
  const editor = await desktopClipboard(page, "", true);
  await editor.click({ button: "right", position: { x: 20, y: 10 } });
  await page.getByRole("menuitem", { name: "粘贴", exact: true }).click();
  await expect(page.locator("#toasts [role=alert]")).toContainText("无法读取剪贴板");
  await expect(editor).toHaveText("replace me");
  expect(await page.evaluate(() => (window as any).clipboardReads)).toBe(1);
});
