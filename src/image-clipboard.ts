import { tr } from "./i18n";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";

/** Native clipboard images contain RGBA pixels, not encoded PNG bytes. */
export async function readClipboardImages(native: boolean): Promise<File[]> {
  if (!native) {
    try {
      const result: File[] = [];
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(type => type.startsWith("image/"));
        if (type) result.push(new File([await item.getType(type)], "clipboard.png", { type }));
      }
      return result;
    } catch { return []; }
  }
  const image = await readImage().catch(() => null);
  if (!image) return [];
  try {
    const { width, height } = await image.size();
    if (!width || !height || width * height > 40_000_000) throw new Error(tr("剪贴板图片尺寸过大"));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(tr("无法读取剪贴板"));
    context.putImageData(new ImageData(new Uint8ClampedArray(await image.rgba()), width, height), 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error(tr("无法读取剪贴板"))), "image/png"));
    return [new File([blob], "clipboard.png", { type: "image/png" })];
  } finally { await image.close(); }
}
