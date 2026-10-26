import { test, expect } from "@playwright/test";

async function loadEditor(page: import("@playwright/test").Page, filename: string, text: string) {
  await page.goto("/tests/code-editor.html");
  return page.evaluate(async ([name, value]) => {
    try {
      const { CodeEditor } = await import("/src/code-editor.ts");
      (window as any).codeChanges = [];
      (window as any).codeSaves = 0;
      (window as any).codeCursorChanges = 0;
      (window as any).codeEditor = new CodeEditor(document.querySelector("#host"), value, name, {
        change: (source: string) => (window as any).codeChanges.push(source),
        cursor: () => (window as any).codeCursorChanges++,
        save: () => (window as any).codeSaves++,
      });
      return "ready";
    } catch (error) {
      return String(error);
    }
  }, [filename, text]);
}

test("loads the generic editor and selects a language from the filename", async ({ page }) => {
  expect(await loadEditor(page, "component.ts", "const answer: number = 42;\nanswer"), "editor should load").toBe("ready");
  await expect.poll(() => page.evaluate(() => (window as any).codeEditor.languageName)).toBe("TypeScript");
  await expect(page.locator(".cm-line").first()).toContainText("answer");
  await expect(page.locator(".cm-lineNumbers .cm-gutterElement").filter({ hasText: /^1$/ })).toBeVisible();
});

test("unknown extensions remain editable as plain text", async ({ page }) => {
  expect(await loadEditor(page, "data.unknown-ext", "first line\nsecond line")).toBe("ready");
  await expect.poll(() => page.evaluate(() => (window as any).codeEditor.languageName)).toBe("Plain Text");
  await page.locator(".cm-content").fill("changed text");
  await expect.poll(() => page.evaluate(() => (window as any).codeChanges.at(-1))).toBe("changed text");
});

test("selection changes notify the host for cursor status", async ({ page }) => {
  await loadEditor(page, "source.txt", "first\nsecond");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await expect.poll(() => page.evaluate(() => (window as any).codeCursorChanges)).toBeGreaterThan(0);
});

test("Control-S invokes the host save callback and flush returns current source", async ({ page }) => {
  expect(await loadEditor(page, "script.js", "const value = 1;")).toBe("ready");
  await page.locator(".cm-content").fill("const value = 2;");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
  await expect.poll(() => page.evaluate(() => (window as any).codeSaves)).toBe(1);
  expect(await page.evaluate(() => (window as any).codeEditor.flush())).toBe("const value = 2;");
  await page.evaluate(() => (window as any).codeEditor.destroy());
  await expect(page.locator(".cm-editor")).toHaveCount(0);
});
