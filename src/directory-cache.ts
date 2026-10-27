import type { Workspace } from "./types";
import { classifyFile } from "./file-types";

export const directoryKey = (path: string) => path.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
export const isNoteFile = (path: string) => /\.(md|markdown|mdx|txt)$/i.test(path);
export const isPictureFile = (path: string) => /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(path);
export const fileGlyph = (path: string) => {
  const kind = classifyFile(path);
  return kind === "markdown" ? "file-text" : kind === "code" ? "code-2" : kind === "image" ? "image" : "file";
};

/** Bounded LRU, concurrent request coalescing, and explicit invalidation after writes. */
export class DirectoryCache {
  private values = new Map<string, Workspace>();
  private pending = new Map<string, Promise<Workspace>>();
  constructor(private readonly limit = 24) {}
  peek(path: string) { return this.values.get(directoryKey(path)); }
  invalidate(path: string) { this.values.delete(directoryKey(path)); this.pending.delete(directoryKey(path)); }
  async load(path: string, fetch: () => Promise<Workspace>): Promise<Workspace> {
    const key = directoryKey(path);
    const cached = this.values.get(key);
    if (cached) {
      this.values.delete(key); this.values.set(key, cached);
      return cached;
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = fetch().then(value => {
      if (this.pending.get(key) === request) {
        this.values.set(key, value);
        while (this.values.size > this.limit) this.values.delete(this.values.keys().next().value!);
      }
      return value;
    }).finally(() => { if (this.pending.get(key) === request) this.pending.delete(key); });
    this.pending.set(key, request);
    return request;
  }
}
