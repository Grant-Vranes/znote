import { CodeEditor } from "./code-editor";
import { tr } from "./i18n";

export type HtmlViewMode = "source" | "rendered";

export interface HtmlViewerOptions {
  path: string;
  source: string;
  initialMode: HtmlViewMode;
  onModeChange(mode: HtmlViewMode): void;
  onSourceChange(text: string): void;
  onCursor?(): void;
  save(): Promise<boolean>;
}

function pathToken(path: string): string {
  const bytes = new TextEncoder().encode(path);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function buildHtmlFrameUrl(path: string, revision = 0): string {
  return `local-html://localhost/${pathToken(path)}/__znote_document__.html?revision=${revision}`;
}

export function defaultHtmlMode(
  _path: string,
  sourceLength: number,
  preferred: HtmlViewMode = "rendered",
): HtmlViewMode {
  return sourceLength > 2 * 1024 * 1024 ? "source" : preferred;
}

export class HtmlViewer {
  readonly root: HTMLElement;
  private readonly options: HtmlViewerOptions;
  private modeKey: string;
  private path: string;
  private source: string;
  private mode: HtmlViewMode;
  private revision = 0;
  private editor?: CodeEditor;
  private frame?: HTMLIFrameElement;
  private switching = false;
  private readonly onClick: (event: MouseEvent) => void;

  constructor(parent: HTMLElement, options: HtmlViewerOptions) {
    this.options = options;
    this.path = options.path;
    this.source = options.source;
    this.modeKey = `znote:html-view:${options.path}`;
    const stored = localStorage.getItem(this.modeKey);
    const preferred = stored === "source" || stored === "rendered" ? stored : options.initialMode;
    this.mode = defaultHtmlMode(options.path, options.source.length, preferred);
    this.root = document.createElement("div");
    this.root.className = "html-viewer";
    this.root.innerHTML = `
      <div class="html-view-toolbar" role="toolbar" aria-label="${tr("HTML 文件视图")}">
        <button type="button" data-html-mode="rendered" aria-pressed="false">${tr("渲染")}</button>
        <button type="button" data-html-mode="source" aria-pressed="false">${tr("源码")}</button>
        <span class="html-view-status" role="status" aria-live="polite"></span>
      </div>
      <section class="html-render-stage" aria-label="${tr("HTML 预览")}" hidden></section>
      <section class="html-source-stage" aria-label="${tr("HTML 源码")}" hidden></section>`;
    this.onClick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-html-mode]");
      if (button) void this.setMode(button.dataset.htmlMode as HtmlViewMode);
    };
    this.root.addEventListener("click", this.onClick);
    parent.append(this.root);
    this.renderMode();
  }

  get view() { return this.editor?.view; }

  get currentMode(): HtmlViewMode { return this.mode; }

  private async setMode(mode: HtmlViewMode): Promise<void> {
    if (mode === this.mode || this.switching) return;
    if (mode === "rendered") {
      this.switching = true;
      try {
        this.source = this.flush();
        this.options.onSourceChange(this.source);
        if (!(await this.options.save())) {
          this.root.querySelector<HTMLElement>(".html-view-status")!.textContent = tr("保存失败，仍保留源码模式");
          return;
        }
      } finally {
        this.switching = false;
      }
    }
    this.mode = mode;
    this.saveMode(mode);
    this.options.onModeChange(mode);
    this.renderMode();
  }

  private saveMode(mode: HtmlViewMode): void {
    try { localStorage.setItem(this.modeKey, mode); } catch { /* The view remains usable if storage is unavailable. */ }
  }

  private renderMode(): void {
    const sourceStage = this.root.querySelector<HTMLElement>(".html-source-stage")!;
    const renderStage = this.root.querySelector<HTMLElement>(".html-render-stage")!;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-html-mode]"))
      button.setAttribute("aria-pressed", String(button.dataset.htmlMode === this.mode));
    sourceStage.hidden = this.mode !== "source";
    renderStage.hidden = this.mode !== "rendered";
    if (this.mode === "source") {
      this.frame?.remove();
      this.frame = undefined;
      if (!this.editor) {
        this.editor = new CodeEditor(sourceStage, this.source, this.path, {
          change: (text) => {
            this.source = text;
            this.options.onSourceChange(text);
          },
          cursor: () => this.options.onCursor?.(),
          save: () => void this.options.save(),
        });
      }
    } else {
      this.editor?.destroy();
      this.editor = undefined;
      sourceStage.replaceChildren();
      this.frame = document.createElement("iframe");
      this.frame.className = "html-document";
      this.frame.title = tr("HTML 预览：{0}", [this.path.split(/[\\/]/).pop() || this.path]);
      this.frame.setAttribute("sandbox", "allow-scripts allow-popups allow-forms");
      this.frame.referrerPolicy = "no-referrer";
      this.frame.src = buildHtmlFrameUrl(this.path, ++this.revision);
      renderStage.replaceChildren(this.frame);
    }
  }

  flush(): string {
    return this.editor?.flush() ?? this.source;
  }

  setPath(path: string): void {
    this.path = path;
    this.modeKey = `znote:html-view:${path}`;
    this.saveMode(this.mode);
    if (this.frame) {
      this.frame.title = tr("HTML 预览：{0}", [path.split(/[\\/]/).pop() || path]);
      this.frame.src = buildHtmlFrameUrl(path, ++this.revision);
    }
  }

  setColorMode(mode: "light" | "dark"): void {
    this.editor?.setColorMode(mode);
  }

  destroy(): void {
    this.root.removeEventListener("click", this.onClick);
    this.editor?.destroy();
    this.frame?.remove();
    this.root.remove();
  }
}
