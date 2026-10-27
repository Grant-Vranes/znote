# 桌面端文件打开支持说明

本文描述 Znote 桌面端（Tauri）当前实际支持的文件类型、打开方式与限制。桌面端是唯一目标平台，移动端不在本说明范围内。

## 支持的类型与打开方式

| 类型 | 扩展名 | 打开方式 | 可编辑 |
|---|---|---|---|
| Markdown | `.md` `.markdown` `.mdx` | 富文本/源码双模式编辑器 | 是 |
| 代码/文本 | `.py` `.js` `.ts` `.json` `.yaml` `.rs` 等常见后缀，以及 Dockerfile、Makefile、`.gitignore`、`.env*` 等常见无后缀/点文件 | CodeMirror 编辑器，按文件名尽力加载语法高亮；未知后缀回退纯文本 | 是 |
| HTML | `.html` `.htm` | 默认沙箱 iframe 渲染（无 same-origin、无 Tauri bridge），可切换源码视图；超过约 2 MiB 的源文件直接以源码模式打开 | 源码可编辑 |
| Draw.io | `.drawio` | 本地打包的 diagrams.net webapp（`drawio-local://` 协议，离线），iframe 消息协议同步 XML | 是 |
| Excalidraw | `.excalidraw` | 独立打包的离线 Excalidraw 应用（`excalidraw-local://` 协议） | 是 |
| PDF | `.pdf` | 内置只读查看器，使用 WebView 的 PDF 能力 | 否 |
| 图片 | `.png` `.jpg/.jpeg` `.gif` `.webp` `.svg` `.bmp` `.ico` `.avif` | 只读查看器：缩放、适配、1:1、旋转、另存为 | 否 |

## 打开入口

- 打开对话框（Ctrl/Cmd+O）使用类型化"All Files"选择器（`choose_opened_file`）。
- 文件树点击任何受支持类型的文件。
- 最近文件列表（媒体文件走类型化媒体打开）。
- 启动参数/系统文件关联（支持多路径、去重）。
- 桌面拖放：`tauri://drag-drop` 事件把路径交给 `open_dropped_paths` 命令，由 Rust 端规范化路径并授权后才读取。

所有入口最终都通过 `dispatchOpenedFiles` 分流到对应 tab 类型，重复路径只开一个 tab。

## 保存与离线行为

- 文本类文件：统一 tab 内容 + dirty 标记 + 冲突安全的原子保存；外部修改后重新打开会保留/提示冲突。
- Draw.io / Excalidraw：画布变更防抖写回 tab，保存前强制 flush 画布当前内容，首份序列化作为基线不误标脏；导出 PNG/SVG 走宿主保存对话框。
- 图形编辑器完全离线：Draw.io 归档按 `resources/drawio.lock.json` 的版本与 SHA-256 校验打包；Excalidraw 独立微应用随安装包携带；运行时不请求任何远程编辑器资源。

## 限制

- **文本读取上限**：单个文本文件最大 16 MB；文件必须是有效 UTF-8（容忍 BOM），检测到 NUL 字节（二进制内容）时拒绝以文本打开。
- **PDF/图片只读**：tab 只保存路径，不把二进制读成文本，不能进入编辑/保存流程（图片支持另存为）。
- **HTML 预览隔离**：预览 iframe 无 same-origin，脚本无法访问宿主或文件系统；相对资源仅允许文档同目录白名单扩展名，禁止路径穿越与符号链接逃逸。
- **损坏的图形文件**：无法识别的 `.drawio` XML / `.excalidraw` JSON 会以空画布和提示打开，不提供格式修复，也不会覆盖原文。
- **桌面专属**：文件树、拖放、文件关联、本地协议均为桌面能力；打包资源缺失或校验不符时构建直接失败（`tests/check-package-assets.mjs`）。

相关实现入口：`src/file-types.ts`（类型路由）、`src/main.ts`（tab 生命周期与打开分流）、`src-tauri/src/file_access.rs`（有界读写与资源授权）、`src-tauri/src/open_requests.rs`（启动队列与拖放路径）。
