import { EMPTY_DRAWIO_XML, isValidDrawioXml } from "./drawio-file";
import { tr } from "./i18n";

export type DiagramExportFormat = "png" | "svg";

export interface DrawioEditorCallbacks {
  change(xml: string): void;
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

function dataUriBytes(value: string): Uint8Array | undefined {
  const match = value.match(/^data:[^,]*;base64,([A-Za-z0-9+/=_-]+)$/);
  if (!match) return undefined;
  try {
    const binary = atob(match[1].replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function parseMessage(data: unknown): Record<string, unknown> | undefined {
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return undefined; }
  }
  return data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : undefined;
}

export class DrawioEditor {
  readonly root: HTMLElement;
  readonly frame: HTMLIFrameElement;
  readonly expectedOrigin: string;
  private readonly allowedOrigins: Set<string>;
  private xml: string;
  private baseline?: string;
  private initialized = false;
  private readonly callbacks: DrawioEditorCallbacks;
  private pendingFlush?: (xml: string) => void;
  private flushTimer?: number;
  private readonly onMessage: (event: MessageEvent) => void;
  private readonly onClick: (event: MouseEvent) => void;

  constructor(parent: HTMLElement, initialXml: string, callbacks: DrawioEditorCallbacks) {
    const valid = isValidDrawioXml(initialXml);
    this.xml = valid ? initialXml : EMPTY_DRAWIO_XML;
    this.callbacks = callbacks;
    const url = "drawio-local://localhost/index.html?embed=1&proto=json&spin=1&ui=min";
    this.allowedOrigins = originSetFor(url);
    this.expectedOrigin = [...this.allowedOrigins].find((origin) => origin !== "null" && !origin.startsWith("http:")) ?? [...this.allowedOrigins][0];
    this.root = document.createElement("div");
    this.root.className = "diagram-editor drawio-editor";
    this.root.innerHTML = `
      <div class="diagram-toolbar" role="toolbar" aria-label="${tr("Draw.io 导出")}">
        <span class="diagram-warning" role="status" ${valid ? "hidden" : ""}>${tr("此文件不是有效的 Draw.io XML；保存前请确认画布内容。")}</span>
        <button type="button" data-export="png">PNG</button>
        <button type="button" data-export="svg">SVG</button>
      </div>
      <iframe class="drawio-frame" title="${tr("Draw.io 图表编辑器")}" sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>`;
    this.frame = this.root.querySelector<HTMLIFrameElement>("iframe")!;
    this.frame.src = url;
    this.onMessage = (event) => this.receive(event);
    this.onClick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-export]");
      const format = button?.dataset.export;
      if (format === "png" || format === "svg") this.post({ action: "export", format });
    };
    window.addEventListener("message", this.onMessage);
    this.root.addEventListener("click", this.onClick);
    parent.append(this.root);
  }

  private post(message: Record<string, unknown>): void {
    try { this.frame.contentWindow?.postMessage(message, targetOrigin(this.expectedOrigin)); }
    catch { this.frame.contentWindow?.postMessage(message, "*"); }
  }

  private receive(event: MessageEvent): void {
    if (event.source !== this.frame.contentWindow) return;
    if (!this.allowedOrigins.has(event.origin)) return;
    const data = parseMessage(event.data);
    if (!data) return;
    const messageEvent = data.event;
    if (messageEvent === "init") {
      this.initialized = true;
      this.post({ action: "load", xml: this.xml, autosave: 1 });
      return;
    }
    if ((messageEvent === "autosave" || messageEvent === "save") && typeof data.xml === "string") {
      const xml = data.xml;
      if (this.baseline === undefined) {
        this.baseline = xml;
        this.xml = xml;
      } else {
        this.xml = xml;
        if (xml !== this.baseline) this.callbacks.change(xml);
      }
      if (messageEvent === "save" || this.pendingFlush) this.finishFlush(xml);
      return;
    }
    if (messageEvent === "export" && (data.format === "png" || data.format === "svg") && typeof data.data === "string") {
      const bytes = dataUriBytes(data.data);
      if (bytes) this.callbacks.export(data.format, bytes);
    }
  }

  private finishFlush(xml: string): void {
    if (this.flushTimer !== undefined) window.clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const resolve = this.pendingFlush;
    this.pendingFlush = undefined;
    resolve?.(xml);
  }

  async flush(): Promise<string> {
    if (!this.initialized) return this.xml;
    return new Promise((resolve) => {
      if (this.flushTimer !== undefined) window.clearTimeout(this.flushTimer);
      this.pendingFlush = resolve;
      this.flushTimer = window.setTimeout(() => this.finishFlush(this.xml), 800);
      this.post({ action: "save" });
    });
  }

  markSaved(xml: string): void {
    this.xml = xml;
    this.baseline = xml;
  }

  destroy(): void {
    if (this.flushTimer !== undefined) window.clearTimeout(this.flushTimer);
    this.pendingFlush = undefined;
    window.removeEventListener("message", this.onMessage);
    this.root.removeEventListener("click", this.onClick);
    this.root.remove();
  }
}
