import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Excalidraw,
  exportToBlob,
  exportToSvg,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  AppState,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { parseExcalidrawScene } from "../../src/excalidraw-scene";
import "@excalidraw/excalidraw/index.css";
import "./style.css";

const HOST_SOURCE = "znote-host";
const APP_SOURCE = "znote-excalidraw";
const PARENT_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://127.0.0.1:1420",
  "http://localhost:1420",
]);

type HostMessage = {
  source?: string;
  type?: string;
  scene?: string;
  format?: "png" | "svg";
};

function parentOriginAllowed(origin: string): boolean {
  return PARENT_ORIGINS.has(origin)
    || /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin);
}

function ExcalidrawApp() {
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const parentOrigin = useRef<string | null>(null);
  const loaded = useRef(false);

  const post = useCallback((message: Record<string, unknown>) => {
    if (!parentOrigin.current) return;
    window.parent.postMessage({ source: APP_SOURCE, ...message }, parentOrigin.current);
  }, []);

  const snapshot = useCallback(() => {
    const current = apiRef.current;
    if (!current) return undefined;
    return serializeAsJSON(
      current.getSceneElements(),
      current.getAppState(),
      current.getFiles(),
      "local",
    );
  }, []);

  const exportScene = useCallback(async (format: "png" | "svg") => {
    const current = apiRef.current;
    if (!current) return;
    const elements = current.getSceneElements();
    const appState = current.getAppState();
    const files = current.getFiles();
    let bytes: number[];
    if (format === "png") {
      const blob = await exportToBlob({ elements, appState, files, mimeType: "image/png" });
      bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    } else {
      const svg = await exportToSvg({ elements, appState, files });
      bytes = Array.from(new TextEncoder().encode(new XMLSerializer().serializeToString(svg)));
    }
    post({ type: "export-result", format, bytes });
  }, [post]);

  useEffect(() => {
    const receive = (event: MessageEvent<HostMessage>) => {
      if (event.source !== window.parent || !parentOriginAllowed(event.origin)) return;
      if (!event.data || event.data.source !== HOST_SOURCE) return;
      parentOrigin.current = event.origin;
      if (event.data.type === "init") {
        post({ type: "ready" });
      } else if (event.data.type === "load" && typeof event.data.scene === "string") {
        const parsed = parseExcalidrawScene(event.data.scene);
        setInitialData({
          elements: parsed.scene.elements as ExcalidrawInitialDataState["elements"],
          appState: parsed.scene.appState as Partial<AppState>,
          files: parsed.scene.files as BinaryFiles,
        });
      } else if (event.data.type === "snapshot") {
        const json = snapshot();
        if (json) post({ type: "snapshot", json });
      } else if (event.data.type === "export" && (event.data.format === "png" || event.data.format === "svg")) {
        void exportScene(event.data.format).catch((error) => {
          post({ type: "export-error", message: String(error) });
        });
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [exportScene, post, snapshot]);

  useEffect(() => {
    if (!initialData || !api || loaded.current) return;
    const frame = requestAnimationFrame(() => {
      const json = snapshot();
      if (!json) return;
      loaded.current = true;
      post({ type: "scene-loaded", json });
    });
    return () => cancelAnimationFrame(frame);
  }, [api, initialData, post, snapshot]);

  const onChange = useCallback((elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    if (!loaded.current) return;
    post({ type: "scene-change", json: serializeAsJSON(elements, appState, files, "local") });
  }, [post]);

  if (!initialData) return <div className="diagram-loading" aria-live="polite">Loading whiteboard…</div>;

  return (
    <Excalidraw
      autoFocus
      initialData={initialData}
      excalidrawAPI={(value) => { apiRef.current = value; setApi(value); }}
      onChange={onChange}
      UIOptions={{
        canvasActions: {
          clearCanvas: true,
          export: false,
          loadScene: false,
          saveAsImage: false,
          saveToActiveFile: false,
        },
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(<ExcalidrawApp />);
