# 当前工程的文件打开支持：设计与实现梳理

> 本文根据当前源码整理 HorseMD 对 Draw.io、Excalidraw、HTML、PDF、图片和代码/文本文件的打开机制，描述的是**现有实现**，不是额外的产品规划。主要入口位于 `src/renderer/src/paths.js`、`hooks/useFileOps.js` 与 `components/shell/EditorArea.jsx`。

## 1. 总体设计

HorseMD 采用“**统一文件入口 + 按文件类型分流到专用查看器/编辑器**”的结构：

1. 桌面端的文件打开对话框提供 Markdown 和“All Files”；工作区文件树也可以列出任意文件。用户从打开对话框、文件树、最近文件、启动参数/系统文件关联或桌面拖放取得路径后，最终进入 renderer 的 `openPaths()`。
2. `openPaths()` 对图片和 PDF 特殊处理：不把二进制内容读入 tab，而是创建只读媒体 tab；其他文件通过 `window.api.readFile()` 读取 UTF-8 文本，再按扩展名决定编辑界面。
3. `EditorArea` 根据路径/显式 `fileType` 选择 Crepe Markdown 编辑器、Draw.io/Excalidraw 画布、HTML 预览或源码、PDF/图片查看器、CodeMirror。重型编辑器和专用画布按需 lazy import，并在 tab 首次进入视图后挂载。
4. 文件读写通过 `window.api`。桌面端由 Electron preload 暴露受限 IPC；renderer 不直接访问 Node.js 文件系统。

桌面端“All Files”过滤器及通用路径入口：`src/main/documents.js:12-18`、`src/main/index.js:27-30, 140-160, 468-477`、`src/main/filesystem.js:12-13, 99-120`。统一打开与类型分流：`src/renderer/src/hooks/useFileOps.js:73-170`、`src/renderer/src/paths.js:90-176`、`src/renderer/src/components/shell/EditorArea.jsx:130-156`。

## 2. 类型路由总览

| 类型 | 识别规则 | tab 内容/读取方式 | 打开界面 | 编辑与保存概况 |
|---|---|---|---|---|
| Markdown | `.md`、`.markdown`、`.mdx` | UTF-8 文本 | Crepe 富文本；可切换源码模式 | Markdown 的现有富文本/源码保存流程 |
| Draw.io | `.drawio` | UTF-8 XML 文本 | 本地 diagrams.net webapp，嵌入 iframe | iframe XML 经消息协议同步到 tab，再由宿主保存；支持导出 PNG/SVG |
| Excalidraw | `.excalidraw` | UTF-8 JSON 场景 | 官方 `@excalidraw/excalidraw` 画布 | 场景序列化到 tab，再由宿主保存；支持导出 PNG/SVG |
| HTML | `.html`、`.htm` | UTF-8 文本 | 默认沙箱 iframe 渲染；也可切换到 CodeMirror 源码 | 源码编辑；切回渲染前先保存到磁盘 |
| PDF | `.pdf` | tab 不读取 PDF 字节，内容为空 | Chromium 内置 PDF viewer，iframe 加载磁盘文件 | 只读；由 Chromium 内置工具栏处理分页、缩放、搜索等 |
| 图片 | `.png`、`.jpg/.jpeg`、`.gif`、`.webp`、`.svg`、`.bmp`、`.ico`、`.avif` | tab 不读取图片字节，内容为空 | `<img>` 图片查看器 | 只读；支持缩放、适配、1:1、旋转和另存为 |
| 代码/其他文本文件 | 除专用类型外，任意有路径的文件 | UTF-8 文本 | CodeMirror；按文件名尽力加载语法包，未知语言仍可作为普通文本编辑 | 走统一 tab 内容、dirty、保存、外部变更流程 |

分类规则和注释见 `src/renderer/src/paths.js:90-176`；实际 UI 分支见 `src/renderer/src/components/shell/EditorArea.jsx:187-390`。

## 3. 各类文件的实现

### 3.1 Draw.io（`.drawio`）

- **文件模型**：`.drawio` 文件作为 XML 文本加载。`isValidDrawioXml()` 识别 `<mxfile>` 或 `<mxGraphModel>` 根标记；不尝试自行解析图形语义。空白新文档使用 `EMPTY_DRAWIO_XML` 模板。相关代码：`src/renderer/src/lib/drawio-file.js:1-21`。
- **画布来源**：不是连接远程 diagrams.net，而是加载本地 vendored 的 `resources/drawio`。主进程注册 `drawio-local://` 协议，限制读取范围在 draw.io 资源目录内；开发与打包环境分别解析资源目录。`src/main/index.js:482-520`。打包前执行 `scripts/fetch-drawio.mjs`，并把资源复制到安装包：`package.json:22-23, 436-437`。
- **嵌入通信**：`DrawioEditor` 以 `embed=1&proto=json` 方式打开 iframe。iframe 发 `init` 后，宿主通过 `postMessage` 发送 `load`；`autosave`/`save` XML 更新 tab；用户显式保存回调宿主保存流程。消息源和 origin 都有校验，目标 origin 固定为 `drawio-local://editor`。实现见 `src/renderer/src/components/DrawioEditor.jsx:1-18, 31-175`。
- **脏状态与可靠保存**：iframe 初次序列化通常会规范化 XML，因此首份 XML 作为 baseline，不因初始化而标脏；正常变更 debounce 500ms。组件卸载时会 flush 未完成的 debounce；宿主注册 `getXml()`，保存时取 iframe 当前 XML，而非依赖可能滞后的 React state。`DrawioEditor.jsx:34-50, 84-117, 159-214`。
- **错误/平台行为**：无法识别的非空 XML 会显示损坏提示并以空画布呈现。桌面能力通过 `capabilities.drawio` 控制；移动端当前未启用该画布，显示占位状态。`src/renderer/src/lib/drawio-file.js:15-21`、`EditorArea.jsx:224-260`、`src/renderer/src/platform/capacitor-api.js:290-301`。

### 3.2 Excalidraw（`.excalidraw`）

- **文件模型**：JSON 中 `type === 'excalidraw'` 视作有效场景，`elements`、`appState`、`files` 缺省时回退为空对象/数组；新文件模板由 `EMPTY_EXCALIDRAW_SCENE` 提供。`src/renderer/src/lib/excalidraw-scene.js:1-20`。
- **画布实现**：直接封装官方 React `Excalidraw` 组件。该模块仅由 `EditorArea` 的 `lazy()` 加载，避免启动时将白板依赖/CSS 带入主编辑器包。`src/renderer/src/components/ExcalidrawEditor.jsx:1-29`、`EditorArea.jsx:20-24`。
- **编辑和保存**：画布变化通过 `serializeAsJSON(..., 'local')` 得到完整场景 JSON，debounce 500ms 后交给 tab 更新；首份场景序列化作为 baseline，避免初始化和视口变化错误标脏；卸载时 flush。注册给宿主的 API 提供即时 `getSceneJson()` 和 PNG/SVG 导出。`ExcalidrawEditor.jsx:18-103`。
- **宿主控制持久化**：关闭 Excalidraw 自带的“打开文件”和内部导出面板（`loadScene: false`、`export: false`），避免其绕过 HorseMD 的 tab/保存路径；文件写入由宿主保存流程负责。`ExcalidrawEditor.jsx:129-145`。
- **无效文件/平台行为**：无法解析的非空文件显示损坏提示并以空画布启动；移动端当前 capability 为 false，在 editor 区显示占位。`ExcalidrawEditor.jsx:26-29, 127-133`、`capacitor-api.js:290-301`。

### 3.3 HTML（`.html`、`.htm`）

- **默认显示方式**：普通大小的 HTML 默认以只读 iframe 渲染。tab 仍持有源文本，但渲染页从磁盘加载，以保留真实相对资源路径语义。路径由 `buildHtmlFrameUrl()` 编码成 `local-html://doc/<绝对路径>`，避免文件名中的 `#`、`?` 被误解析。`src/renderer/src/components/editor-html-view.js:1-49`、`src/renderer/src/components/HtmlEditor.jsx:1-21`。
- **隔离与资源访问**：iframe 使用 `sandbox="allow-scripts allow-popups allow-forms"`，不授予 `allow-same-origin`，所以页面脚本运行在 opaque origin 下，不能访问父窗口/`window.api`。主进程 `local-html` handler 对 HTML 与静态资源扩展名做白名单检查；相对图片、CSS、JS、字体、媒体等可按白名单加载。`HtmlEditor.jsx:11-20`、`src/main/index.js:35-43, 532-559`。
- **桌面开发/打包路径**：`local-html` 用于渲染 iframe。HTML 中引用图片等媒体资源时，桌面 renderer 在非 `file://` 开发环境通过 `local-media://` 转发；打包 renderer 可使用 `file://`。`src/renderer/src/components/editor-images.js:65-85`、`src/main/index.js:523-530, 562-590`。
- **渲染/源码双模式**：工具按钮在“渲染”和 CodeMirror 源码之间切换。切回渲染时先 `saveTab()`，然后递增 render nonce 让 iframe 重新读磁盘；选择的模式按路径写入 `localStorage`，下次打开恢复。`src/renderer/src/App.jsx:865-880`、`editor-html-view.js:9-29`。
- **大文档处理**：源码长度超过约 2 MiB 时不自动渲染，直接以源码视图打开，避免将大 HTML 一次性交给 iframe 做页面布局。当前判断用 JS 字符串 `content.length`，不是文件系统字节数。`src/renderer/src/paths.js:104-114`、`src/renderer/src/hooks/useFileOps.js:137-150`、`EditorArea.jsx:146-147, 297-350`。
- **移动端限制**：HTML tab 在移动端目前显示占位信息；HTML 源码/预览切换按钮也仅桌面端显示，不能把桌面 HTML 预览能力等同于移动端已支持。`EditorArea.jsx:297-350`。

### 3.4 PDF（`.pdf`）

- **只读媒体 tab**：打开时不调用 `readFile()`，创建 `content: ''` 的 tab；这样 PDF 二进制不会被误解码为文本。媒体 tab 被明确排除在普通保存/编辑路径之外。`src/renderer/src/hooks/useFileOps.js:97-118`、`useFileOps.js:490-492`。
- **显示方式**：`PdfViewer` 将绝对路径构造成 URL 并放入 iframe，使用 Chromium 内置 PDF viewer，因此分页、缩放、搜索、书签/目录使用 Chromium 自带 UI。`src/renderer/src/components/PdfViewer.jsx:1-15`。
- **开发环境协议**：在 renderer 不是 `file://` 的开发环境，URL 走 `local-media://media/<path>`。主进程只允许指定图片/PDF/HTML 扩展；PDF response 明确设置 `application/pdf`，确保 Chromium 启用内置 PDF viewer。`src/renderer/src/components/editor-images.js:65-85`、`src/main/index.js:523-530, 562-592`。
- **能力边界**：当前是 PDF **打开/查看**。Markdown 导出为 PDF 是另一条独立导出管线；本文不将 PDF 导出误记为 PDF 文件编辑能力。媒体查看器 capability 在移动端为 false。`src/renderer/src/platform/capacitor-api.js:290-301`。

### 3.5 图片文件

- **支持后缀**：`.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`、`.svg`、`.bmp`、`.ico`、`.avif`。分类定义在 `src/renderer/src/paths.js:150-156`。
- **读取/显示**：图片作为只读媒体 tab 保存文件路径而不读取内容。`MediaViewer` 用 `<img>` 加载本地 URL，并按自然尺寸与 viewport 计算适配比例；显示缩放、适配、1:1、旋转和另存为工具。`src/renderer/src/hooks/useFileOps.js:97-118`、`src/renderer/src/components/MediaViewer.jsx:1-18, 115-189`。
- **开发环境 URL**：打包环境可直接使用 file URL；桌面开发环境把本地 file URL 改写成 `local-media://media/...`，绕过 Chromium 阻止 HTTP renderer 直接读 `file://` 子资源的问题。`src/renderer/src/components/editor-images.js:65-101`。
- **查看能力与编辑器内图片的区别**：以上是“把图片作为独立文件打开”。Markdown 内嵌图片还有单独的解析/相对路径显示和粘贴落盘管线；图片导入时可走图床、附件目录、未保存文档临时目录或 data URL fallback。`src/renderer/src/components/editor-images.js:1-75`、`src/renderer/src/components/editor-image-persistence.js:1-103`。

### 3.6 代码与其他文本文件

- **宽松打开策略**：桌面端当前不是“只支持白名单后缀”。凡是路径文件未被 Markdown、Excalidraw、Draw.io、图片、PDF、HTML 等专用类型接管，`isCodeDoc()` 都归到 CodeMirror；`CODE_EXTS` 是常见语言/文件类型提示列表，而不是开文件许可列表。`src/renderer/src/paths.js:120-148`。
- **常见识别后缀**：Java、Python、YAML、XML、JSON/JSONC/JSON5、JS/TS/JSX/TSX、CSS/SCSS/Less、Vue/Svelte、C/C++/C#、Go、Rust、Ruby、PHP、Swift、Kotlin、Scala、Dart、Lua、Shell/PowerShell、SQL、GraphQL、Protocol Buffers、TOML/INI/config、Gradle、CMake、Dockerfile、env、CSV/TSV、diff/patch、Terraform/HCL、nginx、sln/csproj 等；另外识别 Dockerfile、Makefile、`.gitignore`、`.env*` 等常见无后缀/点文件名。完整清单以 `paths.js:121-138` 为准。
- **CodeMirror 能力**：默认提供行号、历史、查找等基础编辑体验；用 `LanguageDescription.matchFilename(languages, filename)` 尝试按文件名动态加载语言包。未知或加载失败的语言回退为普通文本，不阻止打开。源码更新回 tab；注册 `flushMarkdown` / `flushMarkdownSettled`，使保存取到 CodeMirror 当前文档。`src/renderer/src/components/CodeEditor.jsx:1-16, 149-220`。
- **JSON 格式化**：`.json/.jsonc/.json5` 可用编辑器内格式化按钮；JSONC/JSON5 的解析会尽可能去注释后再解析，格式化失败不改原文，并提供恢复原文入口。`CodeEditor.jsx:27-88, 106-147, 230-270`。
- **纯文本与未知后缀**：当前路径文件统一落到 CodeMirror；未知扩展名只是没有专用语法高亮，并不被扩展名策略拒绝。不要将旧注释中“其他文件走 textarea”的描述当成当前打开策略；现行 `isCodeDoc()` 与 EditorArea 分支决定实际行为。二进制文件不适用此路径。
- **二进制保护（桌面）**：主进程读取前检查文件开头 8 KiB 中是否有 NUL byte；检测到则抛出 `ERR_BINARY_FILE`，renderer 显示“不支持的二进制文件”提示。图片/PDF 由于专用分流不会触发该文本读取。`src/main/filesystem.js:126-141`、`src/renderer/src/hooks/useFileOps.js:154-174`。

## 4. 安全与边界

- **受控文件系统边界**：renderer 通过 `src/preload/index.js` 暴露的 `readFile`、`writeFile`、协议/文件相关 API 与 main 通信，不开放 Node Integration。`preload/index.js:1-48, 86-104`。
- **本地协议按用途收窄**：`drawio-local` 资源限制在 vendored Draw.io 根目录；`local-media` 对扩展名做限制；`local-html` 使用独立 HTML 资源白名单。它们是不同功能的受限读取通道，不是面向 renderer 的任意文件读取 API。`src/main/index.js:482-592`。
- **HTML 与 Draw.io iframe 的沙箱不同**：HTML 预览不授予 same-origin；Draw.io 需与宿主使用受控 postMessage 通信，因此 iframe 使用其所需的 `allow-same-origin`，并在宿主侧校验 message source 与 origin。`HtmlEditor.jsx:11-20`、`DrawioEditor.jsx:82-94, 270-280`。
- **不能误判损坏恢复**：Excalidraw 无法解析的 JSON、Draw.io 不含已识别根标记的内容会启动空画布并显示提示；这不是可靠的格式修复或保真转换机制。`excalidraw-scene.js:9-20`、`drawio-file.js:15-21`。

## 5. 桌面与移动端能力差异

桌面端 Electron capabilities 将 `excalidraw`、`drawio`、`mediaViewer` 开启；Capacitor 移动端将三者设置为 false，因此独立图片/PDF、Draw.io、Excalidraw 的 EditorArea 分支显示占位，而非完整专用编辑器。HTML 也在移动端明确显示占位。`src/preload/index.js:174-205`、`src/renderer/src/platform/capacitor-api.js:290-312`、`src/renderer/src/components/shell/EditorArea.jsx:187-390`。

CodeMirror 与共享 renderer 一起运行；但移动端的文件入口是从系统文件选择器/文件关联复制进应用私有库，桌面端的 native 文件树、拖放和文件监视能力不等同于移动端。移动文件入口与 capability 差异见 `src/renderer/src/platform/capacitor-api.js:180-245, 290-320`。

## 6. 验证入口

仓库提供了与本主题直接相关的测试脚本（脚本名可在 `package.json` 搜索）：

- `npm run test:drawio-file`、`npm run test:drawio-ui`
- `npm run test:excalidraw-ui`
- `npm run test:html-render-ui`
- `npm run test:editor-images`、`npm run test:dev-image-display-ui`、`npm run test:image-paste-source-sync-ui`
- `npm run test:media-viewer-ui`：独立图片/PDF 查看 tab 的 UI 回归。
- `npm run test:pdf-ui`、`npm run test:pdf-images-ui`：主要覆盖 Markdown PDF 导出/预览，不等同于 PDF 文件打开测试。
- `npm run test:drop-open-ui`、`npm run test:filesystem`

## 7. 核心文件索引

| 文件 | 职责 |
|---|---|
| `src/renderer/src/paths.js` | 文件扩展名、专用类型与通用 CodeMirror 路由 |
| `src/renderer/src/hooks/useFileOps.js` | 打开文件、创建 tab、保存、外部文件变化处理 |
| `src/renderer/src/components/shell/EditorArea.jsx` | 按类型挂载具体编辑器/查看器及平台占位 |
| `src/renderer/src/components/DrawioEditor.jsx` | Draw.io iframe 通信、dirty baseline、保存/导出 API |
| `src/renderer/src/components/ExcalidrawEditor.jsx` | Excalidraw 场景加载、序列化、保存/导出 API |
| `src/renderer/src/components/HtmlEditor.jsx`、`editor-html-view.js` | HTML 安全预览 URL 与渲染/源码视图状态 |
| `src/renderer/src/components/PdfViewer.jsx`、`MediaViewer.jsx` | PDF 与独立图片查看器 |
| `src/renderer/src/components/CodeEditor.jsx` | CodeMirror 通用文本/代码编辑器 |
| `src/main/filesystem.js`、`src/main/index.js` | 文件读取、二进制拒绝、本地协议服务 |
| `src/preload/index.js`、`src/renderer/src/platform/capacitor-api.js` | 桌面 IPC bridge 与移动端 API/capability 实现 |
