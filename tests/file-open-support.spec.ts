import { test, expect } from "@playwright/test";

// Shared fixture: typed open surfaces for every supported entry path. Per-test
// configuration travels in the query string because the fixture re-runs on reload.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const app = window as any;
    app.isTauri = true;
    app.calls = [];
    const entry = (path: string, directory = false) => ({ path, name: path.split("/").pop(), directory, children: [] });
    const tree = (root: string) => ({
      root,
      name: root.split("/").pop(),
      truncated: false,
      entries: [
        entry(root + "/a.md"),
        entry(root + "/script.py"),
        entry(root + "/page.html"),
        entry(root + "/diagram.drawio"),
        entry(root + "/scene.excalidraw"),
        entry(root + "/manual.pdf"),
        entry(root + "/picture.png"),
      ],
    });
    const openedFile = (path: string) => {
      const kind = (() => {
        const ext = path.toLowerCase().split(".").pop();
        if (ext === "pdf") return "pdf";
        if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"].includes(ext!)) return "image";
        if (ext === "drawio") return "drawio";
        if (ext === "excalidraw") return "excalidraw";
        if (ext === "html" || ext === "htm") return "html";
        if (ext === "md" || ext === "markdown" || ext === "mdx") return "markdown";
        return "code";
      })();
      return {
        path,
        kind,
        size: 16,
        ...(kind === "pdf" || kind === "image" ? {} : { text: "# " + path, hash: "same", bom: false, eol: "LF" }),
      };
    };
    localStorage.setItem("znote:preferences", JSON.stringify({ fileOpening: { startup: "home", mode: "source", focus: false, target: "current" } }));
    let initial = true;
    let cbSeq = 0;
    let dropHandler: ((event: any) => void) | undefined;
    const params = new URLSearchParams(location.search);
    const config = {
      startupPaths: (params.get("startupPaths") ?? "D:/single/a.md").split(";").filter(Boolean),
      startupErrors: (params.get("startupErrors") ?? "").split(";").filter(Boolean),
      recentFiles: (params.get("recentFiles") ?? "").split(";").filter(Boolean),
      failPath: params.get("failPath") ?? "",
    };
    app.emitDrop = (paths: string[]) => dropHandler?.({ payload: { paths, position: { x: 1, y: 1 } } });
    app.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: (callback: any) => {
        const id = ++cbSeq;
        (window as any)["_" + id] = callback;
        return id;
      },
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        app.calls.push({ command, args });
        if (command === "plugin:event|listen") {
          if (args.event === "tauri://drag-drop") {
            // The handler is a transformCallback id; resolve the real callback on window.
            dropHandler = (event: any) => (window as any)["_" + args.handler]?.(event);
          }
          return 1;
        }
        if (command === "plugin:event|unlisten") return undefined;
        if (command === "pending_open_requests") {
          const result = initial ? [{ id: 1, initial: true, source: "system" }] : [];
          initial = false;
          return result;
        }
        if (command === "complete_open_request")
          return {
            files: config.startupPaths.map(openedFile),
            errors: config.startupErrors,
          };
        if (command === "open_dropped_paths")
          return { files: (args.paths as string[]).map(openedFile), errors: [] };
        if (command === "choose_opened_file") return app.picked ? openedFile(app.picked) : null;
        if (command === "open_file") {
          if (config.failPath === args.path) throw new Error("文件包含二进制内容，无法作为文本打开。");
          return openedFile(args.path);
        }
        if (command === "read_file" || command === "open_recent_file")
          return { path: args.path, text: "# " + args.path, hash: "same", bom: false, eol: "LF" };
        if (command === "document_directory") return tree(args.document.slice(0, args.document.lastIndexOf("/")));
        if (command === "list_directory") return tree(args.path);
        if (command === "choose_workspace") return tree("D:/work");
        if (command === "file_hash") return "same";
        if (command === "list_recent_files") return config.recentFiles;
        if (command === "renderer_info") return { versions: { zensical: "test" } };
        return null;
      },
    };
  });
});

test("open dialog uses the typed all-files picker and renders the diagram canvas", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { (window as any).picked = "D:/single/diagram.drawio"; });
  await page.keyboard.press("Control+o");
  await expect(page.locator("#tabs .tab")).toHaveCount(2);
  await expect(page.locator("iframe.drawio-frame")).toBeVisible();
  const calls = await page.evaluate(() => (window as any).calls.map((c: any) => c.command));
  expect(calls).toContain("choose_opened_file");
  expect(calls).not.toContain("choose_file");
  expect(calls).not.toContain("read_file");
});

test("file tree opens every file kind through the typed open path", async ({ page }) => {
  await page.goto("/?startupPaths=");
  await page.locator('.workspace-switch').click();
  await page.locator('[data-file="D:/work/scene.excalidraw"]').click();
  await expect(page.locator("#tabs .tab")).toHaveCount(1);
  await expect(page.locator("iframe.excalidraw-frame")).toBeVisible();
  await page.locator('[data-file="D:/work/manual.pdf"]').click();
  await expect(page.locator("#tabs .tab")).toHaveCount(2);
  await expect(page.locator("iframe.pdf-document")).toBeVisible();
  await page.locator('[data-file="D:/work/script.py"]').click();
  await expect(page.locator('.cm-editor[data-filename="script.py"]')).toBeVisible();
  const calls = await page.evaluate(() => (window as any).calls.map((c: any) => c.command));
  expect(calls.filter((c: string) => c === "open_file").length).toBe(3);
});

test("opening an unreadable file surfaces the error without creating a tab", async ({ page }) => {
  await page.goto("/?startupPaths=&failPath=D:/work/manual.pdf");
  await page.locator('.workspace-switch').click();
  await page.locator('[data-file="D:/work/manual.pdf"]').click();
  await expect(page.locator(".toast")).toBeVisible();
  await expect(page.locator("#tabs .tab")).toHaveCount(0);
});

test("recent files route media through the typed media open", async ({ page }) => {
  await page.goto("/?startupPaths=&recentFiles=" + encodeURIComponent("D:/single/manual.pdf;D:/single/a.md"));
  await expect(page.locator('#start-recent-list .start-recent-item[data-recent-file]')).not.toHaveCount(0);
  await page.locator('.start-recent-item[data-recent-file="D:/single/manual.pdf"]').first().click();
  await expect(page.locator("#tabs .tab")).toHaveCount(1);
  await expect(page.locator("iframe.pdf-document")).toBeVisible();
  const calls = await page.evaluate(() => (window as any).calls.map((c: any) => c.command));
  expect(calls).toContain("open_file");
  expect(calls).not.toContain("open_recent_file");
});

test("startup requests open multiple typed files and skip duplicates", async ({ page }) => {
  await page.goto("/?startupPaths=" + encodeURIComponent("D:/single/a.md;D:/single/a.md;D:/single/script.py"));
  await expect(page.locator("#tabs .tab")).toHaveCount(2);
});

test("startup errors are surfaced without blocking the typed files", async ({ page }) => {
  await page.goto("/?startupPaths=D:/single/a.md&startupErrors=" + encodeURIComponent("D:/broken/x.exe：文件包含二进制内容，无法作为文本打开。"));
  await expect(page.locator("#tabs .tab")).toHaveCount(1);
  await expect(page.locator(".toast")).toBeVisible();
});

test("dropped paths open through the authorized typed command", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as any).emitDrop(["D:/drop/diagram.drawio", "D:/drop/picture.png"]));
  await expect(page.locator("#tabs .tab")).toHaveCount(3);
  const drop = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.command === "open_dropped_paths"),
  );
  expect(drop.args.paths).toEqual(["D:/drop/diagram.drawio", "D:/drop/picture.png"]);
});
