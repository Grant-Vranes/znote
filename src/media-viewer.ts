import { escapeHtml } from "./preview";
import { tr } from "./i18n";

export interface MediaFile {
  path: string;
  name: string;
  kind: "image" | "pdf";
}

export interface MediaViewerCallbacks {
  saveAs(): Promise<void>;
}

export function mediaUrl(path: string, _kind: "image" | "pdf"): string {
  const bytes = new TextEncoder().encode(path);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  const token = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `local-media://localhost/${token}`;
}

export class MediaViewer {
  private readonly root: HTMLElement;
  private readonly image?: HTMLImageElement;
  private scale = 1;
  private rotation = 0;
  private fit = true;
  private readonly onClick: (event: MouseEvent) => void;

  constructor(parent: HTMLElement, file: MediaFile, callbacks: MediaViewerCallbacks) {
    this.root = document.createElement("div");
    this.root.className = "media-viewer";
    this.root.dataset.kind = file.kind;
    if (file.kind === "image") {
      this.root.innerHTML = `
        <div class="media-toolbar" role="toolbar" aria-label="${tr("图片查看工具")}">
          <button type="button" data-media-action="zoom-out" aria-label="${tr("缩小")}" title="${tr("缩小")}">−</button>
          <button type="button" data-media-action="zoom-in" aria-label="${tr("放大")}" title="${tr("放大")}">+</button>
          <button type="button" data-media-action="fit" aria-label="${tr("适配")}" title="${tr("适配")}">${tr("适配")}</button>
          <button type="button" data-media-action="actual" aria-label="${tr("实际大小")}" title="${tr("实际大小")}">1:1</button>
          <button type="button" data-media-action="rotate" aria-label="${tr("旋转")}" title="${tr("旋转")}">${tr("旋转")}</button>
          <button type="button" data-media-action="save-as" aria-label="${tr("另存为")}" title="${tr("另存为")}">${tr("另存为")}</button>
        </div>
        <div class="media-image-stage" role="region" aria-label="${escapeHtml(file.name)}">
          <img class="media-image" src="${mediaUrl(file.path, file.kind)}" alt="${escapeHtml(file.name)}" draggable="false">
          <p class="media-error" role="alert" hidden>${tr("图片加载失败")}</p>
        </div>`;
      this.image = this.root.querySelector<HTMLImageElement>(".media-image")!;
      this.image.addEventListener("error", () => {
        this.root.querySelector<HTMLElement>(".media-error")!.hidden = false;
      });
      this.updateImageTransform();
    } else {
      this.root.innerHTML = `<iframe class="pdf-document" src="${mediaUrl(file.path, file.kind)}" title="${escapeHtml(file.name)}"></iframe>`;
    }
    this.onClick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-media-action]");
      const action = button?.dataset.mediaAction;
      if (!action) return;
      if (action === "zoom-in") { this.fit = false; this.scale = Math.min(8, this.scale * 1.25); this.updateImageTransform(); }
      else if (action === "zoom-out") { this.fit = false; this.scale = Math.max(0.1, this.scale / 1.25); this.updateImageTransform(); }
      else if (action === "fit") { this.fit = true; this.scale = 1; this.updateImageTransform(); }
      else if (action === "actual") { this.fit = false; this.scale = 1; this.updateImageTransform(); }
      else if (action === "rotate") { this.rotation = (this.rotation + 90) % 360; this.updateImageTransform(); }
      else if (action === "save-as") void callbacks.saveAs();
    };
    this.root.addEventListener("click", this.onClick);
    parent.append(this.root);
  }

  private updateImageTransform() {
    if (!this.image) return;
    this.image.style.maxWidth = this.fit ? "100%" : "none";
    this.image.style.maxHeight = this.fit ? "100%" : "none";
    this.image.style.transform = `rotate(${this.rotation}deg) scale(${this.scale})`;
  }

  destroy(): void {
    this.root.removeEventListener("click", this.onClick);
    this.root.remove();
  }
}
