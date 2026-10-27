import { test, expect } from "@playwright/test";

test("recognizes Draw.io mxfile and mxGraphModel XML and rejects unrelated XML", async ({ page }) => {
  await page.goto("/tests/diagram-file-viewer.html");
  const valid = await page.evaluate(async () => {
    const { isValidDrawioXml } = await import("/src/drawio-file.ts");
    return [
      isValidDrawioXml('<?xml version="1.0"?><mxfile><diagram/></mxfile>'),
      isValidDrawioXml("<mxGraphModel><root/></mxGraphModel>"),
      isValidDrawioXml("<root><mxfile/></root>"),
      isValidDrawioXml("<not-a-diagram/> "),
    ];
  });
  expect(valid).toEqual([true, true, false, false]);
});

test("parses Excalidraw scenes and creates empty defaults without replacing malformed source", async ({ page }) => {
  await page.goto("/tests/diagram-file-viewer.html");
  const result = await page.evaluate(async () => {
    const { parseExcalidrawScene } = await import("/src/excalidraw-scene.ts");
    const parsed = parseExcalidrawScene('{"type":"excalidraw","elements":[]}');
    return {
      valid: parsed.valid,
      elements: parsed.scene.elements,
      files: parsed.scene.files,
      invalidJson: parseExcalidrawScene("not-json").valid,
      invalidType: parseExcalidrawScene('{"type":"other"}').valid,
    };
  });
  expect(result).toEqual({ valid: true, elements: [], files: {}, invalidJson: false, invalidType: false });
});

test("diagram bridges accept only their own frame messages and flush the latest scene", async ({ page }) => {
  await page.goto("/tests/diagram-file-viewer.html");
  const result = await page.evaluate(async () => {
    const [{ DrawioEditor }, { ExcalidrawEditor }] = await Promise.all([
      import("/src/drawio-editor.ts"),
      import("/src/excalidraw-editor.ts"),
    ]);
    const host = document.querySelector("#host")!;
    const drawioChanges: string[] = [];
    const drawioExports: number[][] = [];
    const drawio = new DrawioEditor(host, "<mxfile><diagram/></mxfile>", {
      change: (value: string) => drawioChanges.push(value),
      export: (_format: string, bytes: Uint8Array) => drawioExports.push(Array.from(bytes)),
    });
    const drawioFrame = drawio.frame;
    const sendDrawio = (data: unknown, source: MessageEventSource | null = drawioFrame.contentWindow, origin = drawio.expectedOrigin) => {
      window.dispatchEvent(new MessageEvent("message", { source, origin, data }));
    };
    sendDrawio({ event: "init" });
    sendDrawio({ event: "autosave", xml: "<mxfile><diagram/></mxfile>" });
    sendDrawio({ event: "autosave", xml: "<mxfile><diagram>foreign-source</diagram></mxfile>" }, window);
    sendDrawio({ event: "autosave", xml: "<mxfile><diagram>foreign-origin</diagram></mxfile>" }, drawioFrame.contentWindow, "https://example.invalid");
    const changedXml = "<mxfile><diagram>changed</diagram></mxfile>";
    sendDrawio({ event: "autosave", xml: changedXml });
    sendDrawio({ event: "export", format: "png", data: "data:image/png;base64,QQ==" });
    setTimeout(() => sendDrawio({ event: "save", xml: "<mxfile><diagram>latest</diagram></mxfile>" }), 0);
    const drawioFlushed = await drawio.flush();
    drawio.destroy();
    sendDrawio({ event: "autosave", xml: "<mxfile><diagram>after-destroy</diagram></mxfile>" });

    const excalidrawChanges: string[] = [];
    const excalidrawExports: number[][] = [];
    const excalidraw = new ExcalidrawEditor(host, '{"type":"excalidraw","elements":[]}', {
      change: (value: string) => excalidrawChanges.push(value),
      export: (_format: string, bytes: Uint8Array) => excalidrawExports.push(Array.from(bytes)),
    });
    const excalidrawFrame = excalidraw.frame;
    const sendExcalidraw = (data: unknown, source: MessageEventSource | null = excalidrawFrame.contentWindow, origin = excalidraw.expectedOrigin) => {
      window.dispatchEvent(new MessageEvent("message", { source, origin, data }));
    };
    sendExcalidraw({ source: "znote-excalidraw", type: "ready" });
    const baseline = '{"type":"excalidraw","elements":[]}';
    sendExcalidraw({ source: "znote-excalidraw", type: "scene-loaded", json: baseline });
    sendExcalidraw({ source: "znote-excalidraw", type: "scene-change", json: "foreign" }, window);
    const changedScene = '{"type":"excalidraw","elements":[{"id":"one"}]}';
    sendExcalidraw({ source: "znote-excalidraw", type: "scene-change", json: changedScene });
    sendExcalidraw({ source: "znote-excalidraw", type: "export-result", format: "svg", bytes: [60, 115, 118, 103, 47, 62] });
    setTimeout(() => sendExcalidraw({ source: "znote-excalidraw", type: "snapshot", json: '{"type":"excalidraw","elements":[{"id":"latest"}]}' }), 0);
    const excalidrawFlushed = await excalidraw.flush();
    excalidraw.destroy();
    return {
      drawioChanges,
      drawioExports,
      drawioFlushed,
      drawioSrc: drawioFrame.src,
      drawioSandbox: drawioFrame.getAttribute("sandbox"),
      excalidrawChanges,
      excalidrawExports,
      excalidrawFlushed,
      excalidrawSrc: excalidrawFrame.src,
    };
  });
  expect(result.drawioChanges).toEqual(["<mxfile><diagram>changed</diagram></mxfile>", "<mxfile><diagram>latest</diagram></mxfile>"]);
  expect(result.drawioFlushed).toBe("<mxfile><diagram>latest</diagram></mxfile>");
  expect(result.drawioExports).toEqual([[65]]);
  expect(result.drawioSrc).toMatch(/^drawio-local:\/\/localhost\//);
  expect(result.drawioSandbox).toContain("allow-same-origin");
  expect(result.excalidrawChanges).toEqual(['{"type":"excalidraw","elements":[{"id":"one"}]}']);
  expect(result.excalidrawFlushed).toBe('{"type":"excalidraw","elements":[{"id":"latest"}]}');
  expect(result.excalidrawExports).toEqual([[60, 115, 118, 103, 47, 62]]);
  expect(result.excalidrawSrc).toMatch(/^excalidraw-local:\/\/localhost\//);
});

test("isolated Excalidraw micro-app loads a scene and exports without remote requests", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:1430/")) externalRequests.push(request.url());
  });
  await page.goto("/diagram-app/excalidraw/index.html");
  await page.evaluate(() => {
    (window as any).diagramMessages = [];
    window.addEventListener("message", (event) => (window as any).diagramMessages.push(event.data));
    window.postMessage({ source: "znote-host", type: "init" }, "*");
  });
  await expect.poll(() => page.evaluate(() => (window as any).diagramMessages.some((message: any) => message.type === "ready"))).toBe(true);
  await page.evaluate(() => window.postMessage({
    source: "znote-host",
    type: "load",
    scene: JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} }),
  }, "*"));
  await expect.poll(() => page.evaluate(() => (window as any).diagramMessages.some((message: any) => message.type === "scene-loaded"))).toBe(true);
  await page.evaluate(() => window.postMessage({ source: "znote-host", type: "export", format: "png" }, "*"));
  await expect.poll(() => page.evaluate(() => (window as any).diagramMessages.find((message: any) => message.type === "export-result")?.bytes?.length ?? 0)).toBeGreaterThan(0);
  expect(externalRequests).toEqual([]);
});
