import { test, expect } from "@playwright/test";

async function classify(page: import("@playwright/test").Page, path: string) {
  await page.goto("/tests/file-types.html");
  return page.evaluate(async (filePath) => {
    try {
      const { classifyFile, defaultFileView, isMediaKind } = await import("/src/file-types.ts");
      const kind = classifyFile(filePath);
      return { kind, view: defaultFileView(kind), media: isMediaKind(kind) };
    } catch (error) {
      return { error: String(error) };
    }
  }, path);
}

test("routes common note, code, special, and media filenames", async ({ page }) => {
  const cases: [string, string, string, boolean][] = [
    ["README.md", "markdown", "editor", false],
    ["notes.markdown", "markdown", "editor", false],
    ["component.mdx", "markdown", "editor", false],
    ["notes.txt", "code", "editor", false],
    ["src/App.TSX", "code", "editor", false],
    ["config.yaml", "code", "editor", false],
    ["Dockerfile", "code", "editor", false],
    ["Makefile", "code", "editor", false],
    [".gitignore", "code", "editor", false],
    ["unknown.custom-extension", "code", "editor", false],
    ["page.html", "html", "rendered", false],
    ["page.HTM", "html", "rendered", false],
    ["drawing.drawio", "drawio", "canvas", false],
    ["scene.excalidraw", "excalidraw", "canvas", false],
    ["manual.pdf", "pdf", "media", true],
    ["cover.png", "image", "media", true],
    ["cover.jpg", "image", "media", true],
    ["cover.jpeg", "image", "media", true],
    ["cover.gif", "image", "media", true],
    ["cover.webp", "image", "media", true],
    ["cover.svg", "image", "media", true],
    ["cover.bmp", "image", "media", true],
    ["cover.ico", "image", "media", true],
    ["cover.avif", "image", "media", true],
  ];

  for (const [path, kind, view, media] of cases) {
    expect(await classify(page, `C:/notes/${path}`), path).toEqual({ kind, view, media });
  }
});

test("opens HTML over 2 MiB in source mode", async ({ page }) => {
  await page.goto("/tests/file-types.html");
  const result = await page.evaluate(async () => {
    const { defaultFileView } = await import("/src/file-types.ts");
    return {
      below: defaultFileView("html", 2 * 1024 * 1024),
      above: defaultFileView("html", 2 * 1024 * 1024 + 1),
    };
  });
  expect(result).toEqual({ below: "rendered", above: "editor" });
});
