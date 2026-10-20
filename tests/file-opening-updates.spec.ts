import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

async function desktop(page: Page, options: { initial?: boolean; target?: "new" | "current"; home?: boolean; deferredOpen?: boolean; openError?: boolean; startupError?: boolean; update?: "new" | "none" | "unpublished" | "error" } = {}) {
  await page.addInitScript(options => {
    const app = window as any;
    const path = "C:\\Notes\\中文 笔记.md";
    const doc = { path, text: "# Note", hash: "original", bom: false, eol: "LF" };
    localStorage.setItem("znote:preferences", JSON.stringify({ mode: "split", lastWorkspace: "C:\\Notes", fileOpening: { mode: "read", focus: true, target: options.target ?? "new", startup: options.home ? "home" : "restore" } }));
    let pending = options.initial ? [{ id: 0, initial: true, source: "system" }] : [];
    const callbacks = new Map<number, (event: unknown) => void>();
    const events = new Map<string, number>();
    let callbackId = 0;
    app.isTauri = true; app.calls = [];
    app.emitOpen = () => {
      pending.push({ id: 1, initial: false, source: "system" });
      callbacks.get(events.get("open-requests-ready")!)?.({ payload: null });
    };
    app.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: (callback: (event: unknown) => void) => { callbacks.set(++callbackId, callback); return callbackId; },
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        app.calls.push({ command, args });
        if (command === "plugin:event|listen") {
          if (options.startupError && args.event === "tauri://close-requested") throw new Error("Close listener unavailable");
          events.set(args.event, args.handler); return args.handler;
        }
        if (command === "plugin:window|show") {
          app.revealedLayout = {
            focus: document.body.classList.contains("focus-mode"),
            mode: document.querySelector<HTMLElement>(".writing-area")?.dataset.mode,
            home: !document.querySelector<HTMLElement>("#start-page")?.hidden,
            sidebar: getComputedStyle(document.querySelector("#sidebar")!).display,
            tabs: document.querySelectorAll("#tabs .tab").length,
          };
        }
        if (command === "pending_open_requests") {
          const tickets = pending; pending = [];
          if (options.deferredOpen && tickets.length) await new Promise<void>(resolve => { app.releaseTickets = resolve; });
          return tickets;
        }
        if (command === "complete_open_request") {
          if (options.deferredOpen) await new Promise<void>(resolve => { app.releaseOpen = resolve; });
          return { documents: args.newWindow || options.openError ? [] : [doc], errors: options.openError ? ["File unavailable"] : [] };
        }
        if (command === "remember_recent_file" && app.deferRecent) await new Promise<void>(resolve => { app.releaseRecent = resolve; });
        if (command === "read_recovery") return [];
        if (command === "restore_workspace") return { root: "C:\\Notes", name: "Notes", truncated: false, entries: [] };
        if (command === "list_recent_files") return [];
        if (command === "choose_file") return doc;
        if (command === "renderer_info") return { versions: { zensical: "test" } };
        if (command === "file_hash") return "original";
        if (command === "render_markdown") return { html: "<h1>Note</h1>", toc: [], meta: {}, warnings: [] };
        if (command === "check_for_updates") {
          if (options.update === "error") throw new Error("offline");
          return { currentVersion: "0.5.1", latestVersion: "0.6.0", available: options.update === "new", published: options.update !== "unpublished", title: "ZNote 0.6.0", notes: '<script>window.releaseInjected=true</script>\nChanges', url: "https://github.com/weigo6/znote/releases/tag/v0.6.0" };
        }
        return null;
      },
    };
  }, options);
  await page.goto("/");
  if (options.deferredOpen || options.startupError) return;
  await expect.poll(() => page.evaluate(() => (window as any).calls.some((call: any) => call.command === "renderer_info"))).toBe(true);
}

test("the first native reveal uses the final focus reading layout even when opening is slow", async ({ page }) => {
  const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  expect(tauriConfig.app.windows[0].visible).toBe(false);
  await desktop(page, { initial: true, deferredOpen: true });
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseTickets)).toBe("function");
  expect(await page.evaluate(() => (window as any).revealedLayout)).toBeUndefined();
  await page.evaluate(() => (window as any).releaseTickets());
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseOpen)).toBe("function");
  expect(await page.evaluate(() => (window as any).revealedLayout)).toBeUndefined();
  await page.evaluate(() => (window as any).releaseOpen());
  await expect.poll(() => page.evaluate(() => (window as any).revealedLayout)).toEqual({
    focus: true, mode: "read", home: false, sidebar: "none", tabs: 1,
  });
});

test("current-window opening applies the layout before waiting for recent-file storage", async ({ page }) => {
  await desktop(page, { target: "current", home: true });
  await page.evaluate(() => { (window as any).deferRecent = true; (window as any).emitOpen(); });
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseRecent)).toBe("function");
  await expect(page.locator("body")).toHaveClass(/focus-mode/);
  await expect(page.locator(".writing-area")).toHaveAttribute("data-mode", "read");
  await expect(page.locator("#sidebar")).toBeHidden();
  await expect(page.locator("#tabs .tab")).toHaveCount(1);
  await page.evaluate(() => (window as any).releaseRecent());
});

test("failed file opening still reveals the home screen and error", async ({ page }) => {
  await desktop(page, { initial: true, openError: true });
  await expect.poll(() => page.evaluate(() => (window as any).revealedLayout?.home)).toBe(true);
  await expect(page.getByRole("alert")).toContainText("File unavailable");
});

test("unexpected startup failure still reveals the window", async ({ page }) => {
  await desktop(page, { startupError: true });
  await expect.poll(() => page.evaluate(() => (window as any).revealedLayout?.home)).toBe(true);
  await expect(page.getByRole("alert")).toContainText("Close listener unavailable");
});

test("system startup applies focus reading, skips session restoration, and preserves working preferences", async ({ page }) => {
  await desktop(page, { initial: true });
  await expect(page.locator("body")).toHaveClass(/focus-mode/);
  await expect(page.locator(".writing-area")).toHaveAttribute("data-mode", "read");
  const calls = await page.evaluate(() => (window as any).calls.map((call: any) => call.command));
  expect(calls).not.toContain("restore_workspace"); expect(calls).not.toContain("read_recovery");
  const modes = page.locator(".focus-view-modes");
  await expect(modes.locator('[data-focus-mode="read"]')).toHaveAttribute("aria-pressed", "true");
  for (const value of ["source", "split", "read", "source"]) {
    await modes.locator(`[data-focus-mode="${value}"]`).click();
    await expect(page.locator(".writing-area")).toHaveAttribute("data-mode", value);
    await expect(page.locator("body")).toHaveClass(/focus-mode/);
    await expect(modes.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(modes.locator(`[data-focus-mode="${value}"]`)).toHaveAttribute("aria-pressed", "true");
  }
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("znote:preferences")!).mode)).toBe("split");
  await page.locator('[data-action="focus"]').click();
  await expect(page.locator("body")).not.toHaveClass(/focus-mode/);
  await expect(modes).toBeHidden();
});

test("running app receives new requests without replacing dirty contents or duplicating tabs", async ({ page }) => {
  await desktop(page, { target: "current" });
  await page.keyboard.press("Control+o");
  await page.locator(".tab-editor:not([hidden]) .cm-content").fill("Unsaved text");
  await page.evaluate(() => (window as any).emitOpen());
  await expect(page.locator(".writing-area")).toHaveAttribute("data-mode", "read");
  await expect(page.locator("#tabs .tab")).toHaveCount(1);
  await page.locator('[data-focus-mode="source"]').click();
  await expect(page.locator(".tab-editor:not([hidden]) .cm-content")).toHaveText("Unsaved text");
});

test("running app routes independent reading requests into a new window", async ({ page }) => {
  await desktop(page);
  await page.evaluate(() => (window as any).emitOpen());
  await expect.poll(() => page.evaluate(() => (window as any).calls.find((call: any) => call.command === "complete_open_request")?.args)).toEqual({ id: 1, newWindow: true });
  await expect(page.locator("#start-page")).toBeVisible();
  await expect(page.locator("#tabs .tab")).toHaveCount(0);
});

test("home startup preserves recovery snapshots and opening settings persist", async ({ page }) => {
  await desktop(page, { home: true });
  expect(await page.evaluate(() => (window as any).calls.some((call: any) => ["restore_workspace", "read_recovery"].includes(call.command)))).toBe(false);
  await page.locator('[data-action="settings"]').first().click();
  await page.getByRole("tab", { name: "文件打开", exact: true }).click();
  await page.locator("#external-open-mode").selectOption("source");
  await page.locator("#external-open-focus").uncheck();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("znote:preferences")!).fileOpening)).toMatchObject({ mode: "source", focus: false, startup: "home" });
});

for (const state of ["new", "none", "unpublished", "error"] as const) {
  test(`update check handles ${state} and requires an explicit download action`, async ({ page }) => {
    await desktop(page, { update: state });
    await page.locator('[data-action="settings"]').first().click();
    await page.getByRole("tab", { name: "关于与更新", exact: true }).click();
    await page.getByRole("button", { name: "检查更新", exact: true }).click();
    const expected = { new: "发现新版本", none: "当前已是最新", unpublished: "尚无可用", error: "检查失败" };
    await expect(page.locator("#update-status")).toContainText(expected[state]);
    await expect(page.locator("#check-updates")).toBeEnabled();
    expect(await page.evaluate(() => (window as any).releaseInjected)).toBeUndefined();
    if (state === "new") {
      await expect(page.locator("#update-notes")).toContainText("<script>");
      expect(await page.evaluate(() => (window as any).calls.some((call: any) => call.command === "open_url"))).toBe(false);
      await page.locator("#download-update").click();
      await expect.poll(() => page.evaluate(() => (window as any).calls.find((call: any) => call.command === "open_url")?.args.url)).toBe("https://github.com/weigo6/znote/releases/tag/v0.6.0");
    } else await expect(page.locator("#update-details")).toBeHidden();
  });
}
