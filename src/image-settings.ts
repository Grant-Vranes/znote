import { tr } from "./i18n";
import { settingsPageHeading } from "./settings-navigation";

export interface ImageSettings {
  folder: "assets" | "document" | "same";
  relative: boolean;
  dotPrefix: boolean;
  encodeUrl: boolean;
}
export function normalizeImageSettings(value: unknown): ImageSettings {
  const input = (value && typeof value === "object" ? value : {}) as Partial<ImageSettings>;
  return {
    folder: input.folder === "document" || input.folder === "same" ? input.folder : "assets",
    relative: input.relative !== false,
    dotPrefix: input.dotPrefix === true,
    encodeUrl: input.encodeUrl === true,
  };
}
export function imageExtension(file: Pick<File, "type" | "name" | "size">): string {
  const types: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
  const extension = types[file.type] || (!file.type ? file.name.split(".").pop()?.toLowerCase() : "");
  if (!extension || !["png", "jpg", "jpeg", "gif", "webp"].includes(extension) || !file.size || file.size > 20 * 1024 * 1024)
    throw new Error(tr("请选择 20 MB 以下的常用图片格式"));
  return extension;
}
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || (!file.type && /\.(png|jpe?g|gif|webp)$/i.test(file.name));
}
export function imageMarkdown(name: string, path: string, settings: ImageSettings): string {
  let source = path.replace(/\\/g, "/");
  if (settings.relative && settings.dotPrefix && !source.startsWith(".")) source = `./${source}`;
  // Always escape Markdown delimiters and whitespace; escape percent signs because the renderer decodes paths.
  source = settings.encodeUrl
    ? encodeURI(source).replace(/[()#?']/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    : source.replace(/[%<>()\s]/g, char => encodeURIComponent(char).replace(/[()]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`));
  const alt = name.replace(/[\\\[\]]/g, "\\$&").replace(/[\r\n]+/g, " ");
  return `![${alt}](${source})`;
}
export function imageSettingsMarkup(settings: ImageSettings): string {
  const check = (key: "relative" | "dotPrefix" | "encodeUrl", label: string) => `<label class="setting-row"><span>${tr(label)}</span><input type="checkbox" data-image-setting="${key}" ${settings[key] ? "checked" : ""}></label>`;
  return `<div data-settings-panel="images" hidden>${settingsPageHeading("images")}
    <div class="settings-section"><h3>${tr("插入图片时")}</h3>
      <div class="setting-row"><label for="image-folder">${tr("复制图片到")}</label><select id="image-folder" data-image-setting="folder">
        <option value="assets">./assets</option><option value="document">./\${filename}.assets</option><option value="same">${tr("笔记所在目录")}</option>
      </select></div><p class="muted">${tr("粘贴、拖放和选择的图片都会复制到此目录。未命名笔记会先提示保存。同一内容的图片自动复用。")}</p>
    </div><div class="settings-section"><h3>${tr("图片语法偏好")}</h3>
      ${check("relative", "优先使用相对路径")}${check("dotPrefix", "为相对路径添加 ./")}${check("encodeUrl", "插入时自动转义图片 URL")}
    </div><p class="muted">${tr("支持 PNG、JPEG、GIF、WebP，单张最大 20 MB。网络图片链接保持原样，不自动下载或上传。")}</p></div>`;
}
