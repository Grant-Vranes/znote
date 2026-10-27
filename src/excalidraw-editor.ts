import { EMPTY_EXCALIDRAW_SCENE, parseExcalidrawScene } from "./excalidraw-scene";
import type { DiagramExportFormat } from "./drawio-editor";
import { tr } from "./i18n";

export interface ExcalidrawEditorCallbacks {
  change(json: string): void;
  export(format: DiagramExportFormat, bytes: Uint8Array): void;
}

function originSetFor(url: string): Set<string> {
  const parsed = new URL(url);
  const scheme = parsed.protocol.slice(0, -1);
  const origin = parsed.origin === "null" ? `${parsed.protocol}//${parsed.hostname}` : parsed.origin;
  return new Set([origin, `${scheme}://localhost`, `http://${scheme}.localhost`, "null"]);
}

function targetOrigin(origin: string): string {
  return origin.startsWith("http:") || origin.startsWith("https:") ? origin : "*";
}

export class ExcalidrawEditor {
  readonly root: HTMLElement;
  readonly frame: HTMLIFrameElement;
  readonly expectedOrigin: string;
  private readonly allowedOrigins: Set<string>;
  private json: string;
  private baseline?: string;
  private initialized = false;
  private readonly callbacks: ExcalidrawEditorCallbacks;
  private pendingFlush?: (json: string) => void;
  private flushTimer?: number;
  private readonly onMessage: (event: MessageEvent) => void;
  private readonly onClick: (event: MouseEvent) => void;
  private readonly onFrameLoad: () => void;

  constructor(parent: HTMLElement, initialJson: string, callbacks: ExcalidrawEditorCallbacks) {
    const parsed = parseExcalidrawScene(initialJson);
    this.json = parsed.valid ? initialJson : JSON.stringify(EMPTY_EXCALIDRAW_SCENE);
    this.callbacks = callbacks;
    const url = "excalidraw-local://localhost/index.html";
    this.allowedOrigins = originSetFor(url);
    this.expectedOrigin = [...this.allowedOrigins].find((origin) => origin !== "null" && !origin.startsWith("http:")) ?? [...this.allowedOrigins][0];
    this.root = document.createElement("div");
    this.root.className = "diagram-editor excalidraw-editor";
    this.root.innerHTML = `
      <div class="diagram-toolbar" role="toolbar" aria-label="${tr("Excalidraw 导出")}">
        <span class="diagram-warning" role="status" ${parsed.valid ? "hidden" : ""}>${tr("Excalidraw 文件损坏，画布将以空场景打开。修改后再保存可替换原内容。")}</span>
        <button type="button" data-export="png">PNG</button>
        <button type="button" data-export="svg">SVG</button>
      </div>
      <iframe class="excalidraw-frame" title="${tr("Excalidraw 白板")}" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>`;
    this.frame = this.root.querySelector<HTMLIFrameElement>("iframe")!;
    this.onMessage = (event) => this.receive(event);
    this.onClick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-export]");
      const format = button?.dataset.export;
      if (format === "png" || format === "svg") this.post({ source: "znote-host", type: "export", format });
    };
    this.onFrameLoad = () => this.post({ source: "znote-host", type: "init" });
    window.addEventListener("message", this.onMessage);
    this.root.addEventListener("click", this.onClick);
    this.frame.addEventListener("load", this.onFrameLoad);
    parent.append(this.root);
    this.frame.src = url;
  }

  private post(message: Record<string, unknown>): void {
    try { this.frame.contentWindow?.postMessage(message, targetOrigin(this.expectedOrigin)); }
    catch { this.frame.contentWindow?.postMessage(message, "*"); }
  }

  private receive(event: MessageEvent): void {
    if (event.source !== this.frame.contentWindow) return;
    if (!this.allowedOrigins.has(event.origin)) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.source !== "znote-excalidraw") return;
    if (data.type === "ready") {
      this.post({ source: "znote-host", type: "load", scene: this.json });
    } else if (data.type === "scene-loaded" && typeof data.json === "string") {
      this.json = data.json;
      this.baseline = data.json;
      this.initialized = true;
      this.finishFlush(data.json);
    } else if (data.type === "scene-change" && typeof data.json === "string" && this.initialized) {
      this.json = data.json;
      if (this.json !== this.baseline) this.callbacks.change(this.json);
      if (this.pendingFlush) this.finishFlush(this.json);
    } else if (data.type === "snapshot" && typeof data.json === "string") {
      this.json = data.json;
      this.finishFlush(this.json);
    } else if (data.type === "export-result" && (data.format === "png" || data.format === "svg") && Array.isArray(data.bytes)) {
      const bytes = data.bytes.filter((value): value is number => Number.isInteger(value) && value >= 0 && value <= 255);
      this.callbacks.export(data.format, Uint8Array.from(bytes));
    }
  }

  private finishFlush(json: string): void {
    if (this.flushTimer !== undefined) window.clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const resolve = this.pendingFlush;
    this.pendingFlush = undefined;
    resolve?.(json);
  }

  async flush(): Promise<string> {
    if (!this.initialized) return this.json;
    return new Promise((resolve) => {
      if (this.flushTimer !== undefined) window.clearTimeout(this.flushTimer);
      this.pendingFlush = resolve;
      this.flushTimer = window.setTimeout(() => this.finishFlush(this.json), 800);
      this.post({ source: "znote-host", type: "snapshot" });
    });
  }

  markSaved(json: string): void {
    this.json = json;
    this.baseline = json;
  }

  destroy(): void {
    if (this.flushTimer !== undefined) window.clearTimeout(this.flushTimer);
    this.pendingFlush = undefined;
    window.removeEventListener("message", this.onMessage);
    this.root.removeEventListener("click", this.onClick);
    this.frame.removeEventListener("load", this.onFrameLoad);
    this.root.remove();
  }
}
