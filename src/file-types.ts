import type { FileKind } from "./types";

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif",
]);

const CODE_EXTENSIONS = new Set([
  ".java", ".py", ".yaml", ".yml", ".xml", ".json", ".jsonc", ".json5",
  ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx",
  ".css", ".scss", ".sass", ".less", ".vue", ".svelte", ".c", ".h",
  ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".cs", ".go", ".rs", ".rb",
  ".php", ".swift", ".kt", ".kts", ".scala", ".dart", ".lua", ".sh",
  ".bash", ".zsh", ".ps1", ".psm1", ".sql", ".graphql", ".gql", ".proto",
  ".toml", ".ini", ".cfg", ".conf", ".properties", ".gradle", ".cmake",
  ".env", ".csv", ".tsv", ".diff", ".patch", ".tf", ".tfvars", ".hcl",
  ".nginx", ".sln", ".csproj", ".editorconfig", ".npmrc", ".gitattributes",
  ".npmignore", ".gitmodules", ".lock", ".makefile",
]);

const CODE_BASENAMES = new Set([
  "dockerfile", "makefile", "jenkinsfile", "justfile", "procfile",
  ".gitignore", ".gitattributes", ".gitmodules", ".editorconfig", ".npmrc",
  ".npmignore", ".dockerignore", ".prettierrc", ".eslintignore",
]);

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
}

export function classifyFile(path: string): FileKind {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot) : "";

  if ([".md", ".markdown", ".mdx"].includes(extension)) return "markdown";
  if (extension === ".html" || extension === ".htm") return "html";
  if (extension === ".drawio") return "drawio";
  if (extension === ".excalidraw") return "excalidraw";
  if (extension === ".pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (CODE_BASENAMES.has(name) || name.startsWith("dockerfile.") || name.startsWith("makefile.") || /^\.env(?:\.|$)/.test(name)) return "code";
  if (CODE_EXTENSIONS.has(extension)) return "code";
  return "code";
}

export function isMediaKind(kind: FileKind): boolean {
  return kind === "pdf" || kind === "image";
}

export function defaultFileView(
  kind: FileKind,
  contentLength = 0,
): "editor" | "rendered" | "canvas" | "media" {
  if (kind === "pdf" || kind === "image") return "media";
  if (kind === "drawio" || kind === "excalidraw") return "canvas";
  if (kind === "html") return contentLength > 2 * 1024 * 1024 ? "editor" : "rendered";
  return "editor";
}
