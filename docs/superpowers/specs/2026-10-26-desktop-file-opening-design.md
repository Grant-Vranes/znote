# Desktop file-opening support design

## Context

`docs/file-open-support.md` describes a file-opening system from a different Electron/React application. Znote is a vanilla TypeScript/Vite frontend with a Tauri 2/Rust backend, so its referenced paths and components cannot be ported directly. This design adapts its file-type matrix and behavior to Znote while retaining Znote's existing Markdown workflows.

The current app's `Tab` and save pipeline assume Markdown/text, the native picker filters to `.md`, `.markdown`, and `.txt`, and binary files cannot be represented by `DiskDocument`. Workspace files can include arbitrary entries, but only Markdown/text opens as a tab; pictures use an attachment preview and other files are revealed externally.

## Goals

- Open Markdown, common code/text files, HTML, PDF, supported images, Draw.io, and Excalidraw through one desktop file-opening flow.
- Keep Markdown behavior unchanged and give each other type an appropriate editor or viewer.
- Preserve tab lifecycle guarantees: duplicate-path reuse, dirty state, save/conflict handling, recovery snapshots, recent files, and close confirmation.
- Bundle diagram application assets for offline runtime use.
- Keep filesystem access in Rust/Tauri and enforce restrictive rules for HTML rendering and media resources.

## Non-goals

- iOS/Android implementation.
- Editing PDF/image files.
- Arbitrary binary-file editing or encoding conversion.
- Runtime network loading of Draw.io, Excalidraw, fonts, scripts, or other editor resources.
- Replacing or migrating Znote's application shell or Markdown editor.

## File type model and routing

Add an explicit renderer-side file kind classifier with these routes:

| Kind | Extensions / identification | Behavior |
|---|---|---|
| Markdown | `.md`, `.markdown`, `.mdx` | Existing Znote Markdown editor, preview, and save behavior. |
| Code/text | Common code/config/data extensions and otherwise any valid UTF-8 non-binary file | Editable CodeMirror editor with filename-based language support when available; unknown extensions remain editable as plain text. |
| HTML | `.html`, `.htm` | Sandboxed rendered view by default, with a source-editing mode; source edits are saved by the host. HTML over approximately 2 MiB opens in source mode by default. |
| Draw.io | `.drawio` | Locally bundled Draw.io editor in an isolated frame; XML text is the persisted source. |
| Excalidraw | `.excalidraw` | Locally bundled Excalidraw editor; JSON scene is the persisted source. |
| PDF | `.pdf` | Read-only media tab; load from a restricted local media URL without decoding the bytes as text. |
| Image | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`, `.avif` | Read-only media tab with fit/zoom/actual-size/rotate and save-as actions where appropriate. |

The native open dialog uses an All Files filter. Startup/system-open requests, recent files, file-tree clicks, and drag/drop use the same `openPaths`-style classification and duplicate-tab policy. A failed read reports a localized error and does not create a misleading editable tab. Files that are not valid UTF-8 or contain NUL bytes are rejected from text routes; PDF and images never enter text decoding.

## Renderer architecture

### File classification and tab model

Introduce a pure file-type module for extension/name classification, default view selection, media detection, and per-kind capabilities. Extend the existing tab model with an explicit kind and view state rather than scattering extension checks through event handlers. Preserve shared identity/path/revision/hash/dirty/conflict fields. Text kinds carry source text; media kinds carry only a path and viewer state. Canvas editors update the tab source via a narrow adapter and expose a flush/snapshot operation for host saves.

The Markdown editor remains unchanged. Add focused modules for generic code editing, HTML source/render mode, PDF/image viewing, Draw.io bridge, and Excalidraw bridge. Keep heavy diagram bundles lazy and mount a viewer/editor only for the active tab. Reuse the existing `DocumentText`, dirty-state comparison, conflict checks, recent-file handling, and recovery system wherever the tab has editable text.

### Open and save flows

Every open source resolves to a path and calls a shared dispatcher. The dispatcher classifies the path, opens read-only media without text reads, and obtains UTF-8 content for editable kinds. Opening a path already present in the tab strip activates the existing tab.

Editable text and diagram files use the same Rust atomic-write and expected-hash conflict protection as existing notes. Save-as preserves the original extension by default for non-Markdown files; Markdown's existing `.md` behavior remains unchanged. The save pipeline must flush the active code/HTML/canvas editor before capturing the save snapshot. Read-only media tabs are excluded from save, recovery text, and dirty prompts. Close/reopen, recovery restore, external modification, rename, duplicate, and file-tree operations must handle media and non-Markdown editable tabs without treating them as Markdown.

### Viewer behavior

- Generic code/text uses a separate CodeMirror setup so Markdown-specific commands and preview do not leak into code documents. Add common language packages matching the file matrix; unknown or unavailable languages degrade to plain text.
- HTML has a sandboxed preview iframe without `allow-same-origin`; it receives no Tauri bridge. Relative local resources are served through a dedicated restricted local HTML/media protocol, with extension allowlists and paths confined to the opened HTML document's directory. A view toggle saves pending source changes before reloading the preview. Persist the selected HTML view per path. Large HTML opens in source mode.
- PDF and image tabs are read-only. Use a restricted local-media protocol with explicit supported extensions and correct PDF MIME type. Image viewing supports fit, zoom, 1:1, rotation, and save-as; SVG is displayed as an image, not injected as inline markup.
- Draw.io and Excalidraw are isolated, locally bundled editor surfaces. They exchange only the minimum serialized XML/JSON and supported export messages with the host. Validate message source/origin, establish an initial serialization baseline so initialization does not mark a tab dirty, and flush pending debounced changes before save/unmount.

## Tauri/Rust boundary and security

Renderer code does not access Node.js or arbitrary filesystem APIs. Rust commands own text reads/writes and binary/media authorization. Extend the existing access model so explicit selections, workspace files, and opened documents can be read through constrained commands. Add a separate local-media/local-html resource handler with a strict extension allowlist, canonicalized paths, and authorization to the opened document or its permitted sibling resources. Reject traversal, symlink escapes, unsupported extensions, and requests outside the permitted document scope. Keep HTML iframes sandboxed and do not allow same-origin access or `window.api` access. Do not expose a general-purpose arbitrary-file URL handler.

The chooser filters, file-tree glyphs, error strings, and capability checks must be updated consistently. Desktop Tauri is the supported target for this work; no claim of mobile viewer/editor support is made.

## Error handling

- Invalid UTF-8/NUL-containing text files show an unsupported-binary/encoding message and remain unopened.
- Malformed non-empty Draw.io XML or Excalidraw JSON shows a damaged-file state; it must not silently overwrite the file with an empty scene. User edits are only persisted after an explicit save.
- Local resource read failures show an in-view error and preserve the document path/state.
- Missing bundled diagram assets or unsupported runtime capability shows a clear unavailable state.
- Save conflicts retain the in-memory content and use the existing conflict resolution UI.

## Testing and acceptance criteria

1. Unit-test extension classification, default modes, size threshold, and unknown-language fallback.
2. Rust-test text size/UTF-8/NUL checks, binary/media route separation, media extension allowlists, canonical path restrictions, and traversal/symlink rejection.
3. Playwright-test opening via picker, file tree, recent/startup requests, and drag/drop; duplicate tabs; code source edits; HTML preview/source persistence; image/PDF read-only behavior; canvas baseline/flush/save; dirty prompts, recovery, and conflict handling.
4. Confirm packaged Draw.io and Excalidraw work without network access and resource files are included in desktop builds.
5. Run `npm run check`, relevant Playwright tests, desktop asset/package checks, and `cargo test`.

The feature is accepted when all listed file classes route as specified, editable types round-trip through save/reopen without content loss, media does not enter text paths, HTML and local resource access remain restricted, diagram assets function offline, and existing Markdown tests continue to pass.

## Implementation sequence

1. Add file-kind classification and tests; adjust Tauri file selection and text/binary APIs.
2. Generalize tab metadata/save/recovery boundaries while preserving Markdown behavior; add generic CodeMirror text editing.
3. Add secure local media serving and read-only image/PDF tabs.
4. Add restricted HTML preview/source mode with local relative resource support.
5. Add offline Draw.io and Excalidraw editor surfaces, host message validation, dirty baselines, and save flushing.
6. Integrate all open entry points, file tree/recent/startup handling, packaging, and end-to-end regressions.
