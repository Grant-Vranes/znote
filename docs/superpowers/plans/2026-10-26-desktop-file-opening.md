# Desktop file-opening support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add desktop Tauri support to open, edit, view, and safely save Markdown, code/text, HTML, PDF, images, Draw.io, and Excalidraw files in Znote.

**Architecture:** Keep the current TypeScript/Vite + Tauri/Rust application shell and add a shared file-kind router plus type-aware tabs. Rust remains the only filesystem boundary, with bounded text reading/writing and narrowly scoped local-resource protocols. Specialized editors/viewers are separate modules, lazily mounted, and reuse the host's tab dirty/save/recovery lifecycle where editable.

**Tech Stack:** TypeScript, Vite, CodeMirror 6, Tauri 2, Rust, Playwright, Cargo tests, React 19 for the isolated `@excalidraw/excalidraw` bundle; offline bundled Draw.io and Excalidraw surfaces.

## Global Constraints

- Desktop Tauri is the only target; do not claim mobile support.
- Runtime diagram and preview resources must work offline; do not load editor bundles from remote sites.
- Do not enable Node integration or expose arbitrary filesystem access to renderer code.
- HTML preview must not receive same-origin access or the Tauri bridge.
- Preserve Markdown behavior and existing conflict-safe atomic saves.
- Unknown valid UTF-8 text extensions remain editable as plain text; unsupported binary input must never enter text tabs.
- Preserve unrelated working-tree changes; currently `src/editor.ts`, `src/main.ts`, `src/preview-surface.ts`, `tests/app-sync.spec.ts`, and `docs/file-open-support.md` already have uncommitted user changes.

---

## File Map

| File | Responsibility |
|---|---|
| `src/file-types.ts` (new) | Pure extension/name routing, mode defaults, media/editable predicates. |
| `tests/file-types.spec.ts` (new) | Classification table and boundary tests. |
| `tests/file-types.html` (new) | Vite fixture used by the pure routing tests. |
| `src/types.ts` | Shared opened-file metadata and tab-kind types. |
| `src/main.ts` | Unified open dispatch, kind-aware tabs, editor mounting, save/recovery/close integration, and entry points. |
| `src/editor.ts` | Existing Markdown editor; avoid unrelated changes. |
| `src/code-editor.ts` (new) | Generic CodeMirror setup, filename-based language selection, host callbacks. |
| `src/media-viewer.ts` (new) | Image/PDF viewer state and safe media URL construction. |
| `src/html-viewer.ts` (new) | Sandboxed HTML iframe and render/source mode state. |
| `src/drawio-editor.ts` (new) | Draw.io iframe protocol, dirty baseline, serialization/flush API. |
| `src/excalidraw-editor.ts` (new) | Excalidraw surface bridge, serialization/flush API. |
| `src/style.css` | Type-specific editor/viewer layout and responsive states. |
| `src-tauri/src/main.rs` | All-files chooser, typed open results, command registration, media save-as. |
| `src-tauri/src/file_access.rs` (new) | Bounded text reads, file-kind mapping, safe resource authorization, URI response helpers. |
| `src-tauri/src/open_requests.rs` | Native startup/system-open requests for all supported types. |
| `src-tauri/src/file_operations.rs` | Keep workspace mutations safe and limit text-specific duplicate operations to editable text kinds. |
| `src-tauri/tauri.conf.json` | Strict CSP, resource protocol scope, desktop file associations, drag/drop enablement. |
| `src-tauri/tauri.windows.conf.json` | Windows package resources and installer integration. |
| `src-tauri/tauri.macos.conf.json`, `src-tauri/tauri.linux.conf.json` | Platform package resources for offline viewer/editor bundles. |
| `scripts/fetch-drawio.mjs` (new) | Fetch and verify the pinned official Draw.io webapp archive at build time, never runtime. |
| `resources/drawio.lock.json` (new) | Exact Draw.io release URL and SHA-256 used by the fetch script. |
| `build/desktop-resources/drawio/draw.war` (generated) | Compressed offline Draw.io webapp; Tauri serves only allowlisted entries from the archive to avoid unpacking a 100+ MiB tree. |
| `diagram-app/excalidraw/` (new) | Standalone React/Excalidraw micro-app, separate from Znote's vanilla renderer. |
| `scripts/build-desktop.mjs` | Produce/copy standalone diagram frontend bundles and validate resource presence. |
| `package.json`, `pnpm-lock.yaml` | Add CodeMirror languages and isolated Excalidraw dependencies/scripts. |
| `tests/file-open-support.spec.ts` (new) | Playwright end-to-end flows for type routing and lifecycle. |
| `tests/check-package-assets.mjs` | Validate required offline resources are in desktop packages. |
| `tests/code-editor.html` (new) | Vite fixture for generic editor behavior tests. |

## Task 1: Define and test file routing

**Files:**
- Create: `src/file-types.ts`
- Create: `tests/file-types.spec.ts`
- Create: `tests/file-types.html`
- Modify: `src/types.ts`

**Interfaces:**
- Add `export type FileKind = "markdown" | "code" | "html" | "drawio" | "excalidraw" | "pdf" | "image"` to `src/types.ts`.
- Produce in `src/file-types.ts` `export function classifyFile(path: string): FileKind`.
- Produce in `src/file-types.ts` `export function isMediaKind(kind: FileKind): boolean` and `export function defaultFileView(kind: FileKind, contentLength?: number): "editor" | "rendered" | "canvas" | "media"`; import `FileKind` from `src/types.ts`.

- [x] **Step 1: Create `tests/file-types.html`** as a minimal Vite fixture that imports `src/file-types.ts`; add failing table-driven tests for `.md/.markdown/.mdx`, `.txt`, HTML, PDF, all image extensions from the approved design, `.drawio`, `.excalidraw`, common code/config suffixes, Dockerfile/Makefile/dotfiles, case-insensitive suffixes, and unknown suffix fallback.
- [x] **Step 2: Run `npx playwright test tests/file-types.spec.ts`** and verify it fails because the module is absent.
- [x] **Step 3: Implement the pure classifier** with explicit specialist-first routing (media/HTML/diagram before generic code), basename handling for known extensionless files, and generic-code fallback.
- [x] **Step 4: Test the HTML 2 MiB view threshold** and all classifier cases; run `npm run check`.
- [x] **Step 5: Commit** `feat: add typed file routing`.

## Task 2: Add bounded native open/read/write and resource authorization

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/open_requests.rs`
- Modify: `src-tauri/src/file_operations.rs`
- Modify: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/file_access.rs`
- Modify: `src-tauri/src/main.rs` to register `file_access` and use its interfaces

**Interfaces:**
- Define a serde tagged `OpenedFile` return shape `{ path: string, kind: FileKind, text?: string, hash?: string, bom?: boolean, eol?: string, size?: number }` shared with `src/types.ts`.
- Add Rust `classify_path(path: &Path) -> FileKind` and `read_opened_file(path: &Path) -> Result<OpenedFile>` in `file_access.rs`; media returns metadata only, never decoded content.
- Register `open_file(path: String) -> Result<OpenedFile>`; native picker, startup, and drop handlers return the same `OpenedFile` structure.
- Add Rust `authorize_local_resource(document: &Path, requested: &Path, kind: ResourceKind) -> Result<PathBuf>` in `file_access.rs` for scoped HTML/media resources.
- Keep existing `save_file` optimistic hash check and atomic write; permit supported text/diagram extensions, never binary media.

- [x] **Step 1: Write failing Rust unit tests** for each extension route, UTF-8/BOM/EOL behavior, NUL and invalid UTF-8 rejection, existing 16 MiB limit, binary-media metadata-only open, supported resource extensions, path traversal, symlink escape, and sibling/subdirectory allowance within HTML's parent.
- [x] **Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml`** and confirm the new tests fail before the implementation.
- [x] **Step 3: Implement `OpenedFile` and shared Rust route helpers**, retaining `Document` conversion for Markdown-only APIs that still require it.
- [x] **Step 4: Add `open_file` and unfiltered `choose_opened_file` commands while retaining the existing Markdown-only `read_file`/`choose_file` interfaces for compatibility; route startup requests through the typed API in Task 7.**
- [x] **Step 5: Add restricted media and HTML URI handlers** with canonical path checks, extension/MIME allowlists, no directory listing, no traversal, and no generic arbitrary-file serving. Add CSP entries only for the local schemes needed by the viewers.
- [x] **Step 6: Make the Rust tests pass**, then run `cargo test --manifest-path src-tauri/Cargo.toml` and `npm run check`.
- [x] **Step 7: Commit** `feat: add safe typed file reads and media protocols`.

## Task 3: Generalize tab lifecycle and add generic code/text editor

**Files:**
- Create: `src/code-editor.ts`
- Modify: `src/main.ts`
- Modify: `src/types.ts`
- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `tests/code-editor.spec.ts`
- Create: `tests/code-editor.html`

**Interfaces:**
- `CodeEditor(parent: HTMLElement, text: string, filename: string, callbacks: { change(text: string): void; save(): void })` exposes `flush(): string`, `focus(): void`, `destroy(): void`.
- Extend the tab model with `kind: FileKind`; editable tabs store source/hash/BOM/EOL and editor-specific flush/dispose adapters, while media tabs have no editable source.
- Add a shared `dispatchOpenedFiles(files: OpenedFile[])` renderer dispatcher that creates/activates the matching tab; tree and recent-file paths first call `open_file`, while picker/startup/drop use their native typed results.

- [x] **Step 1: Create `tests/code-editor.html`** as a minimal fixture that imports `src/code-editor.ts`, then write failing Playwright tests for filename language selection, plain-text fallback, change callbacks, Mod-S, and cleanup; include a Markdown editor regression assertion that `NoteEditor` remains the Markdown-specific path.
- [x] **Step 2: Run `npx playwright test tests/code-editor.spec.ts`** and confirm the new tests fail.
- [x] **Step 3: Add only common CodeMirror language packages** needed for JavaScript/TypeScript, JSON, CSS, HTML/XML, YAML, Python, Rust, SQL, and Markdown-independent generic text; configure a deterministic fallback language.
- [x] **Step 4: Implement the focused `CodeEditor`** and run its tests.
- [x] **Step 5: Refactor `addTab`, `mountTab`, `activate`, `save`, `closeTab`, `recoveryData`, and restore flows in `src/main.ts`** to branch on the tab kind and flush editors before save snapshots. Do not edit neighboring user-modified logic without first inspecting/rebasing it.
- [x] **Step 6: Route Code/Text and Markdown through `dispatchOpenedFiles`**; ensure `.txt` is generic text, Markdown extensions preserve current Znote preview, and save-as keeps non-Markdown extensions.
- [x] **Step 7: Add Playwright cases for unknown extension editing, content round-trip, recovery, save conflict, duplicate tab, and dirty close confirmation. Run the tests plus `npm run check` and `npm run test:browser -- tests/app-sync.spec.ts` (the two pre-existing, user-modified app-sync tests still fail; see baseline).
- [x] **Step 8: Commit** `feat: edit code and text files in tabs`.

## Task 4: Add image and PDF media tabs

**Files:**
- Create: `src/media-viewer.ts`
- Modify: `src/main.ts`
- Modify: `src/directory-cache.ts`
- Modify: `src/style.css`
- Create: `tests/media-viewer.spec.ts`
- Modify: `src-tauri/src/main.rs` to add `save_media_as` command

**Interfaces:**
- `mediaUrl(path: string, kind: "image" | "pdf"): string` constructs a URL for the restricted Rust protocol using encoded path segments.
- `MediaViewer(parent: HTMLElement, file: {path: string; name: string; kind: "image" | "pdf"}, callbacks: {saveAs(): Promise<void>})` exposes `destroy(): void`.
- Rust `save_media_as(path: String) -> Result<Option<String>>` opens a native Save As dialog, copies the authorized media file byte-for-byte, and returns the destination path.
- Media tabs are read-only and expose no text, save, recovery snapshot, or dirty state.

- [x] **Step 1: Add failing browser tests** asserting image/PDF route to viewers, use the restricted local URL, display image controls, do not call `read_file`, do not render a CodeMirror editor, and cannot become dirty.
- [x] **Step 2: Run `npx playwright test tests/media-viewer.spec.ts`** and verify it fails.
- [x] **Step 3: Implement `MediaViewer`** with fit/zoom/actual size/rotation and save-as for images; PDF uses a native iframe pointed at the local-media URL and correct `application/pdf` response.
- [x] **Step 4: Integrate media tab creation/close/activation in `src/main.ts`** and update file glyphs in `src/directory-cache.ts`.
- [x] **Step 5: Run browser tests and Rust resource-protocol tests**, then `npm run check`.
- [x] **Step 6: Commit** `feat: add read-only image and pdf tabs`.

## Task 5: Add safe HTML preview and source mode

**Files:**
- Create: `src/html-viewer.ts`
- Modify: `src/main.ts`
- Modify: `src/style.css`
- Modify: `src-tauri/src/main.rs` local HTML/media handler
- Modify: `src-tauri/tauri.conf.json` CSP
- Create: `tests/html-file-viewer.spec.ts`

**Interfaces:**
- `HtmlViewer(parent: HTMLElement, options: {path: string; initialMode: "source" | "rendered"; onModeChange(mode: "source" | "rendered"): void; onSourceChange(text: string): void; save(): Promise<boolean>})` exposes `destroy(): void`.
- HTML source remains the editable tab source; preview loads the local HTML protocol URL in an iframe with `sandbox="allow-scripts allow-popups allow-forms"` and never `allow-same-origin`.

- [x] **Step 1: Add failing tests** for sandbox attributes, no Tauri bridge, safe local relative image/CSS loading, denied traversal/unsupported resource extensions, render/source switching, saving source before rerender, mode persistence, and >2 MiB initial source mode.
- [x] **Step 2: Run `npx playwright test tests/html-file-viewer.spec.ts`** and verify expected failures.
- [x] **Step 3: Implement the local HTML resource mapping** so the document and allowed relative sibling resources remain confined to its canonical parent. Verify relative links cannot resolve outside this root, including encoded traversal and symlink cases.
- [x] **Step 4: Implement the sandboxed viewer and source toggle**; restore per-file mode only when content length is below threshold and preserve unsaved edits if rendering fails.
- [x] **Step 5: Run Playwright and Rust security tests**, plus `npm run check`.
- [x] **Step 6: Commit** `feat: preview html files safely`.

## Task 6: Add offline Draw.io and Excalidraw editors

**Files:**
- Create: `src/drawio-editor.ts`
- Create: `src/excalidraw-editor.ts`
- Create: `diagram-app/excalidraw/index.html`
- Create: `diagram-app/excalidraw/main.tsx`
- Create: `diagram-app/excalidraw/vite.config.ts`
- Create: `scripts/fetch-drawio.mjs`
- Create: `resources/drawio.lock.json`
- Modify: `scripts/build-desktop.mjs`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` to read the pinned ZIP archive with the `zip` crate
- Modify: `src-tauri/tauri.conf.json`, `src-tauri/tauri.windows.conf.json`, `src-tauri/tauri.macos.conf.json`, `src-tauri/tauri.linux.conf.json`, `src-tauri/src/main.rs`
- Modify: `package.json`, `pnpm-lock.yaml`
- Modify: `tests/check-package-assets.mjs`
- Create: `tests/diagram-file-viewer.spec.ts`

**Interfaces:**
- `DrawioEditor(parent: HTMLElement, initialXml: string, callbacks: {change(xml: string): void; save(): void})` exposes `flush(): string`, `destroy(): void`.
- `ExcalidrawEditor(parent: HTMLElement, initialJson: string, callbacks: {change(json: string): void; save(): void})` exposes `flush(): string`, `destroy(): void`.
- Bridge accepts messages only from the expected iframe `contentWindow` and exact bundled origin; the first serialized scene establishes the baseline and does not mark dirty.

- [x] **Step 1: Add failing bridge tests** for invalid document detection, accepted init/load/save messages, rejected foreign source/origin messages, baseline non-dirty behavior, debounced update flushing, and host save snapshot freshness.
- [x] **Step 2: Run `npx playwright test tests/diagram-file-viewer.spec.ts`** and confirm missing surfaces/bridge fail.
- [x] **Step 3: Build an isolated Excalidraw app bundle** compatible with the current host and check its license/size; provide host-only file load/save and export capabilities (no internal open/export file workflow).
- [x] **Step 4: Pin Draw.io release `https://github.com/jgraph/drawio/releases/download/v32.6.1/draw.war` with SHA-256 `44dd56958c8408963457dc98f04d2228408ac145c7aa1d8e6895d9c88d5e42aa`** in `resources/drawio.lock.json`; implement `scripts/fetch-drawio.mjs` to verify the archive and stage `draw.war` into `build/desktop-resources/drawio/`. Serve allowlisted ZIP entries directly from Rust to keep the installed resources compressed. Disable remote runtime endpoints with a restrictive Draw.io response CSP.
- [x] **Step 5: Add Draw.io and Excalidraw bridges** with origin/source validation, initial baselines, debounced updates, `flush()` on save and teardown, plus damaged-file states that never overwrite input on initialization.
- [x] **Step 6: Add offline asset/package checks** and run diagram browser tests against bundled local assets with network requests blocked.
- [x] **Step 7: Run `npm run check`, relevant Playwright tests, `node tests/check-package-assets.mjs`, and `cargo test --manifest-path src-tauri/Cargo.toml`.
- [x] **Step 8: Commit** `feat: add offline diagram editors`.

## Task 7: Integrate every open source and full regression coverage

**Files:**
- Modify: `src/main.ts`
- Modify: `src-tauri/src/open_requests.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/tauri.conf.json` to declare supported desktop file associations
- Modify: `src-tauri/windows/file-associations.nsh` for Windows installer registration
- Create: `tests/file-open-support.spec.ts`
- Modify: `tests/document-directory.spec.ts` to cover tree opening for each kind
- Modify: `tests/start-page.spec.ts` to cover recent-file routing for editable and media files
- Modify: `tests/file-opening-updates.spec.ts` to cover typed startup results and new-window behavior

**Interfaces:**
- All entry paths deliver `OpenedFile[]` to `dispatchOpenedFiles`: open dialog, tree click, recent item, startup/system association, and Tauri drag/drop event.
- Tauri drag/drop is enabled and sends dropped paths only from the native `tauri://drag-drop` event to `open_dropped_paths(paths: Vec<String>)`; that command canonicalizes the paths, grants access for those user-selected files, and returns typed open results.

- [x] **Step 1: Add failing integration tests** for picker/all-files label, file tree, recent files, multiple startup paths, drop-open, duplicates, and error handling per file kind.
- [x] **Step 2: Run `npx playwright test tests/file-open-support.spec.ts`** and confirm missing entry flows fail.
- [x] **Step 3: Update frontend open entry points and Rust startup queue** to return typed open records; keep new-window routing and existing startup reveal behavior unchanged.
- [x] **Step 4: Add supported extension file associations** to the shared Tauri bundle configuration and Windows installer script; test each declared extension maps to the Znote executable.
- [x] **Step 5: Route Tauri `tauri://drag-drop` event paths to `open_dropped_paths(paths: Vec<String>)`** and verify dropped paths are canonicalized and authorized before any file read.
- [x] **Step 6: Run integration tests** for open dialog, tree, recent files, startup, association, and drop paths.
- [x] **Step 7: Update file icons, recent labels, title/status text, save keyboard shortcut, save-as defaults, and close/reopen flow for non-Markdown types.** Ensure read-only media cannot invoke editable operations.
- [x] **Step 8: Run all new type/file/media/HTML/diagram Playwright tests and existing file-opening, directory, startup, save, and app-sync tests.**
- [x] **Step 9: Commit** `feat: integrate typed file opening across desktop`.

## Task 8: Package and final verification

**Files:**
- Modify: `scripts/build-desktop.mjs`
- Modify: `tests/check-package-assets.mjs`
- Create: `docs/desktop-file-support.md` with supported formats and limitations

- [x] **Step 1: Add a failing package assertion** that built desktop output contains Draw.io, Excalidraw, and local viewer resources and does not depend on network fetches at runtime.
- [x] **Step 2: Run `node tests/check-package-assets.mjs`** and verify it identifies missing bundled resources before implementation.
- [x] **Step 3: Update desktop build/copy scripts** to bundle all pinned assets deterministically; fail the build with an actionable message if a required resource is absent or version/checksum mismatched.
- [x] **Step 4: Document supported extensions, read-only formats, source/render modes, offline diagram behavior, UTF-8/binary limits, and desktop-only scope.**
- [x] **Step 5: Run final verification:** `npm run check`, `npm run build`, `npm test`, `cargo test --manifest-path src-tauri/Cargo.toml`, and the desktop asset/package test. Record any environment-dependent build failures without claiming success.
- [x] **Step 6: Review `git diff` and `git status`** to confirm user changes remain untouched and no generated binaries or unpinned external artifacts were added unintentionally.
- [x] **Step 7: Commit** `test: verify desktop file type support`.

## Plan self-review

- **Spec coverage:** Task 1 covers the complete file-kind matrix and HTML size threshold; Task 2 covers Tauri text/media reads, resource authorization, binary rejection, and atomic-save compatibility; Task 3 covers editable code/text tabs and lifecycle; Task 4 covers image/PDF read-only viewing; Task 5 covers sandboxed HTML and relative assets; Task 6 covers offline diagram editors and message validation; Task 7 covers every opening source and cross-kind lifecycle; Task 8 covers packaging, user documentation, and full regression verification.
- **Type consistency:** `FileKind` is defined in `src/types.ts`; TypeScript routing returns it; Rust serializes the corresponding kind in `OpenedFile`; `dispatchOpenedFiles` accepts `OpenedFile[]`; media and canvas editor interfaces are explicitly typed above.
- **Placeholder scan:** No TBD/TODO implementation items remain. Draw.io version and SHA-256 are selected as a concrete release artifact and recorded in `resources/drawio.lock.json` before the fetch script is used; the lock file is mandatory for build success.
