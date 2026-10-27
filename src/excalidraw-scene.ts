export interface ExcalidrawScene {
  type: "excalidraw";
  version?: number;
  source?: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  [key: string]: unknown;
}

export const EMPTY_EXCALIDRAW_SCENE: ExcalidrawScene = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [],
  appState: {},
  files: {},
};

export interface ParsedExcalidrawScene {
  valid: boolean;
  scene: ExcalidrawScene;
}

export function parseExcalidrawScene(value: string): ParsedExcalidrawScene {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return { valid: false, scene: structuredClone(EMPTY_EXCALIDRAW_SCENE) };
    const record = parsed as Record<string, unknown>;
    if (record.type !== "excalidraw" || !Array.isArray(record.elements))
      return { valid: false, scene: structuredClone(EMPTY_EXCALIDRAW_SCENE) };
    return {
      valid: true,
      scene: {
        ...record,
        type: "excalidraw",
        elements: record.elements,
        appState: record.appState && typeof record.appState === "object" && !Array.isArray(record.appState)
          ? record.appState as Record<string, unknown>
          : {},
        files: record.files && typeof record.files === "object" && !Array.isArray(record.files)
          ? record.files as Record<string, unknown>
          : {},
      },
    };
  } catch {
    return { valid: false, scene: structuredClone(EMPTY_EXCALIDRAW_SCENE) };
  }
}
