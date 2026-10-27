use super::{hash, Result};
use base64::Engine as _;
use serde::Serialize;
use std::{fs, path::Path};

const MAX_TEXT_FILE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum FileKind {
    Markdown,
    Code,
    Html,
    Drawio,
    Excalidraw,
    Pdf,
    Image,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenedFile {
    pub(crate) path: String,
    pub(crate) kind: FileKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) bom: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) eol: Option<String>,
    pub(crate) size: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ResourceKind {
    HtmlAsset,
    Image,
    Pdf,
}

pub(crate) fn classify_path(path: &Path) -> FileKind {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "md" | "markdown" | "mdx" => FileKind::Markdown,
        "html" | "htm" => FileKind::Html,
        "drawio" => FileKind::Drawio,
        "excalidraw" => FileKind::Excalidraw,
        "pdf" => FileKind::Pdf,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif" => FileKind::Image,
        _ if matches!(
            name.as_str(),
            "dockerfile" | "makefile" | "jenkinsfile" | "justfile" | ".gitignore"
        ) || name.starts_with("dockerfile.")
            || name.starts_with("makefile.")
            || name.starts_with(".env") =>
        {
            FileKind::Code
        }
        _ => FileKind::Code,
    }
}

pub(crate) fn validate_diagram_export(
    format: &str,
    size: usize,
) -> Result<(&'static str, &'static str)> {
    if size == 0 || size > 100 * 1024 * 1024 {
        return Err("图表导出为空或超过 100 MB。".into());
    }
    match format {
        "png" => Ok(("png", "image/png")),
        "svg" => Ok(("svg", "image/svg+xml")),
        _ => Err("仅支持 PNG 和 SVG 图表导出。".into()),
    }
}

pub(crate) fn copy_media_file(source: &Path, destination: &Path) -> Result<()> {
    let source = source.canonicalize().map_err(|error| error.to_string())?;
    let kind = match classify_path(&source) {
        FileKind::Image => ResourceKind::Image,
        FileKind::Pdf => ResourceKind::Pdf,
        _ => return Err("仅支持另存图片或 PDF 文件。".into()),
    };
    let source = authorize_local_resource(&source, &source, kind)?;
    let source_extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let parent = destination
        .parent()
        .ok_or("另存位置缺少父目录")?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let destination = if destination.exists() {
        destination
            .canonicalize()
            .map_err(|error| error.to_string())?
    } else {
        parent.join(destination.file_name().ok_or("另存文件名无效")?)
    };
    let destination_extension = destination
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if source_extension != destination_extension {
        return Err("另存时必须保留原文件扩展名。".into());
    }
    if source == destination {
        return Ok(());
    }
    let size = fs::metadata(&source)
        .map_err(|error| error.to_string())?
        .len();
    let limit = if kind == ResourceKind::Pdf {
        256 * 1024 * 1024
    } else {
        20 * 1024 * 1024
    };
    if size > limit {
        return Err("文件过大，无法另存。".into());
    }
    let bytes = fs::read(&source).map_err(|error| error.to_string())?;
    super::atomic_write(&destination, &bytes)
}

pub(crate) fn save_as_name(name: &str, kind: FileKind) -> String {
    if kind == FileKind::Markdown
        && ![".md", ".markdown", ".mdx"]
            .iter()
            .any(|extension| name.to_ascii_lowercase().ends_with(extension))
    {
        format!("{name}.md")
    } else {
        name.to_owned()
    }
}

pub(crate) fn ensure_text_writable(kind: FileKind) -> Result<()> {
    if matches!(kind, FileKind::Pdf | FileKind::Image) {
        Err("媒体文件为只读，不能作为文本保存。".into())
    } else {
        Ok(())
    }
}

pub(crate) fn read_opened_file(path: &Path) -> Result<OpenedFile> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("请选择文件".into());
    }
    let kind = classify_path(path);
    let size = metadata.len();
    if matches!(kind, FileKind::Pdf | FileKind::Image) {
        return Ok(OpenedFile {
            path: path.to_string_lossy().into_owned(),
            kind,
            text: None,
            hash: None,
            bom: None,
            eol: None,
            size,
        });
    }
    if size > MAX_TEXT_FILE_BYTES {
        return Err("文件超过 16 MB，请使用专门的大文件编辑器。".into());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let content = if bom { &bytes[3..] } else { &bytes };
    let text = std::str::from_utf8(content)
        .map_err(|_| "文件不是有效 UTF-8。为避免破坏原文，请先转换编码。")?;
    if text.contains('\0') {
        return Err("文件包含二进制内容，无法作为文本打开。".into());
    }
    let eol = if text.contains("\r\n") { "CRLF" } else { "LF" };
    Ok(OpenedFile {
        path: path.to_string_lossy().into_owned(),
        kind,
        text: Some(text.to_owned()),
        hash: Some(hash(&bytes)),
        bom: Some(bom),
        eol: Some(eol.to_owned()),
        size,
    })
}

pub(crate) fn read_drawio_asset(
    archive_path: &Path,
    requested: &str,
) -> Result<(Vec<u8>, &'static str)> {
    use std::io::Read;
    let decoded = decode_uri_path(requested)?;
    let relative = decoded.trim_start_matches('/');
    let relative = if relative.is_empty() {
        "index.html"
    } else {
        relative
    };
    let path = Path::new(relative);
    if path.is_absolute()
        || relative.contains('\\')
        || relative.contains(':')
        || path.components().any(|part| {
            matches!(
                part,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
        || relative.starts_with("WEB-INF/")
        || relative.starts_with("META-INF/")
    {
        return Err("Draw.io 资源路径无效".into());
    }
    let file = fs::File::open(archive_path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
    let mut entry = archive
        .by_name(relative)
        .map_err(|_| "Draw.io 资源不存在")?;
    if entry.is_dir() || entry.size() > 128 * 1024 * 1024 {
        return Err("Draw.io 资源无效或过大".into());
    }
    let content_type = mime_type(path).unwrap_or("application/octet-stream");
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok((bytes, content_type))
}

pub(crate) fn decode_path_token(value: &str) -> Result<String> {
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| "无效的本地资源 URL")?;
    String::from_utf8(decoded).map_err(|_| "本地资源路径不是有效 UTF-8".into())
}

pub(crate) fn decode_uri_path(value: &str) -> Result<String> {
    let source = value.as_bytes();
    let mut decoded = Vec::with_capacity(source.len());
    let mut index = 0;
    while index < source.len() {
        if source[index] == b'%' {
            if index + 2 >= source.len() {
                return Err("无效的本地资源 URL".into());
            }
            let hex = std::str::from_utf8(&source[index + 1..index + 3])
                .map_err(|_| "无效的本地资源 URL")?;
            decoded.push(u8::from_str_radix(hex, 16).map_err(|_| "无效的本地资源 URL")?);
            index += 3;
        } else {
            decoded.push(source[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).map_err(|_| "本地资源 URL 不是有效 UTF-8".into())
}

pub(crate) fn mime_type(path: &Path) -> Option<&'static str> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "html" | "htm" => Some("text/html; charset=utf-8"),
        "css" => Some("text/css; charset=utf-8"),
        "js" | "mjs" => Some("text/javascript; charset=utf-8"),
        "json" | "map" => Some("application/json"),
        "xml" => Some("application/xml"),
        "txt" | "md" | "properties" | "mf" => Some("text/plain; charset=utf-8"),
        "pdf" => Some("application/pdf"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"),
        "woff" => Some("font/woff"),
        "woff2" => Some("font/woff2"),
        "ttf" => Some("font/ttf"),
        "otf" => Some("font/otf"),
        "eot" => Some("application/vnd.ms-fontobject"),
        "mp4" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "mp3" => Some("audio/mpeg"),
        "ogg" => Some("audio/ogg"),
        "wav" => Some("audio/wav"),
        "wasm" => Some("application/wasm"),
        _ => None,
    }
}

pub(crate) fn authorize_local_resource(
    document: &Path,
    requested: &Path,
    kind: ResourceKind,
) -> Result<std::path::PathBuf> {
    let document = document.canonicalize().map_err(|error| error.to_string())?;
    if !document.is_file() {
        return Err("本地资源所属文档无效".into());
    }
    let root = document
        .parent()
        .ok_or("本地资源所属文档缺少父目录")?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let requested = requested
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !requested.is_file() || !requested.starts_with(&root) {
        return Err("本地资源超出文档目录范围".into());
    }
    let extension = requested
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let allowed = match kind {
        ResourceKind::HtmlAsset => matches!(
            extension.as_str(),
            "html"
                | "htm"
                | "css"
                | "js"
                | "mjs"
                | "json"
                | "xml"
                | "map"
                | "png"
                | "jpg"
                | "jpeg"
                | "gif"
                | "webp"
                | "svg"
                | "bmp"
                | "ico"
                | "avif"
                | "woff"
                | "woff2"
                | "ttf"
                | "otf"
                | "eot"
                | "mp4"
                | "webm"
                | "mp3"
                | "ogg"
                | "wav"
                | "wasm"
        ),
        ResourceKind::Image => matches!(
            extension.as_str(),
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif"
        ),
        ResourceKind::Pdf => extension == "pdf",
    };
    if !allowed {
        return Err("不支持的本地资源格式".into());
    }
    Ok(requested)
}

#[cfg(test)]
mod tests {
    use super::{
        authorize_local_resource, classify_path, read_opened_file, FileKind, ResourceKind,
    };
    use std::{fs, path::Path};
    use tempfile::tempdir;

    #[test]
    fn routes_every_special_file_kind_and_unknown_text() {
        assert_eq!(classify_path(Path::new("note.MDX")), FileKind::Markdown);
        assert_eq!(classify_path(Path::new("view.html")), FileKind::Html);
        assert_eq!(classify_path(Path::new("view.htm")), FileKind::Html);
        assert_eq!(classify_path(Path::new("diagram.drawio")), FileKind::Drawio);
        assert_eq!(
            classify_path(Path::new("scene.excalidraw")),
            FileKind::Excalidraw
        );
        assert_eq!(classify_path(Path::new("manual.pdf")), FileKind::Pdf);
        assert_eq!(classify_path(Path::new("photo.avif")), FileKind::Image);
        assert_eq!(classify_path(Path::new("source.custom")), FileKind::Code);
    }

    #[test]
    fn reads_utf8_text_and_preserves_document_metadata() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, b"\xef\xbb\xbfhello\r\nworld").unwrap();

        let opened = read_opened_file(&path).unwrap();

        assert_eq!(opened.kind, FileKind::Markdown);
        assert_eq!(opened.text.as_deref(), Some("hello\r\nworld"));
        assert_eq!(opened.bom, Some(true));
        assert_eq!(opened.eol.as_deref(), Some("CRLF"));
        assert_eq!(opened.size, 15);
        assert!(opened.hash.is_some());
    }

    #[test]
    fn rejects_invalid_utf8_nul_and_oversized_text() {
        let dir = tempdir().unwrap();
        let invalid = dir.path().join("invalid.txt");
        fs::write(&invalid, [0xff, 0xfe]).unwrap();
        assert!(read_opened_file(&invalid).unwrap_err().contains("UTF-8"));

        let binary = dir.path().join("binary.txt");
        fs::write(&binary, b"prefix\0suffix").unwrap();
        assert!(read_opened_file(&binary).unwrap_err().contains("二进制"));

        let oversized = dir.path().join("large.txt");
        fs::write(&oversized, vec![b'a'; 16 * 1024 * 1024 + 1]).unwrap();
        assert!(read_opened_file(&oversized).unwrap_err().contains("16 MB"));
    }

    #[test]
    fn media_open_returns_metadata_without_text_decoding() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("image.png");
        fs::write(&path, [0, 159, 255, 0]).unwrap();

        let opened = read_opened_file(&path).unwrap();

        assert_eq!(opened.kind, FileKind::Image);
        assert_eq!(opened.text, None);
        assert_eq!(opened.size, 4);
        assert_eq!(opened.hash, None);
    }

    #[test]
    fn decodes_media_path_tokens_as_utf8_file_paths() {
        assert_eq!(
            super::decode_path_token("QzovTm90ZXMv5Lit5paHIGNvdmVyICMxLnBuZw").unwrap(),
            "C:/Notes/中文 cover #1.png"
        );
        assert!(super::decode_path_token("not-valid-base64").is_err());
    }

    #[test]
    fn decodes_uri_paths_without_treating_plus_as_space() {
        assert_eq!(
            super::decode_uri_path("images/my%20photo%23one.png").unwrap(),
            "images/my photo#one.png"
        );
        assert_eq!(super::decode_uri_path("a+b.css").unwrap(), "a+b.css");
        assert!(super::decode_uri_path("bad%2").is_err());
        assert!(super::decode_uri_path("%FF").is_err());
    }

    #[test]
    fn serves_only_safe_drawio_archive_entries_with_content_types() {
        use std::io::Write;
        use zip::{write::SimpleFileOptions, ZipWriter};

        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("draw.war");
        let mut archive = ZipWriter::new(fs::File::create(&archive_path).unwrap());
        archive
            .start_file("index.html", SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"<html>offline</html>").unwrap();
        archive
            .start_file("WEB-INF/web.xml", SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"server configuration").unwrap();
        archive.finish().unwrap();

        let (html, mime) = super::read_drawio_asset(&archive_path, "/index.html").unwrap();
        assert_eq!(String::from_utf8(html).unwrap(), "<html>offline</html>");
        assert_eq!(mime, "text/html; charset=utf-8");
        assert!(super::read_drawio_asset(&archive_path, "/../secret.txt").is_err());
        assert!(super::read_drawio_asset(&archive_path, "/WEB-INF/web.xml").is_err());
    }

    #[test]
    fn allows_only_bounded_png_and_svg_diagram_exports() {
        assert_eq!(
            super::validate_diagram_export("png", 1).unwrap(),
            ("png", "image/png")
        );
        assert_eq!(
            super::validate_diagram_export("svg", 1).unwrap(),
            ("svg", "image/svg+xml")
        );
        assert!(super::validate_diagram_export("html", 1).is_err());
        assert!(super::validate_diagram_export("png", 0).is_err());
        assert!(super::validate_diagram_export("png", 100 * 1024 * 1024 + 1).is_err());
    }

    #[test]
    fn save_as_copies_media_bytes_and_keeps_the_media_extension() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.png");
        let destination = dir.path().join("copy.png");
        fs::write(&source, [0, 255, 17, 0]).unwrap();

        super::copy_media_file(&source, &destination).unwrap();

        assert_eq!(fs::read(&destination).unwrap(), [0, 255, 17, 0]);
        assert!(super::copy_media_file(&source, &dir.path().join("copy.pdf")).is_err());
    }

    #[test]
    fn save_as_preserves_code_extensions_and_keeps_markdown_default() {
        assert_eq!(
            super::save_as_name("script.py", FileKind::Code),
            "script.py"
        );
        assert_eq!(super::save_as_name("Makefile", FileKind::Code), "Makefile");
        assert_eq!(super::save_as_name("draft", FileKind::Markdown), "draft.md");
        assert_eq!(
            super::save_as_name("notes.markdown", FileKind::Markdown),
            "notes.markdown"
        );
    }

    #[test]
    fn rejects_text_writes_for_read_only_media_kinds() {
        assert!(super::ensure_text_writable(FileKind::Markdown).is_ok());
        assert!(super::ensure_text_writable(FileKind::Code).is_ok());
        assert!(super::ensure_text_writable(FileKind::Drawio).is_ok());
        assert!(super::ensure_text_writable(FileKind::Excalidraw).is_ok());
        assert!(super::ensure_text_writable(FileKind::Pdf).is_err());
        assert!(super::ensure_text_writable(FileKind::Image).is_err());
    }

    #[test]
    fn maps_resource_mime_types_without_sniffing_file_contents() {
        assert_eq!(
            super::mime_type(Path::new("manual.pdf")),
            Some("application/pdf")
        );
        assert_eq!(
            super::mime_type(Path::new("photo.svg")),
            Some("image/svg+xml")
        );
        assert_eq!(
            super::mime_type(Path::new("style.css")),
            Some("text/css; charset=utf-8")
        );
        assert_eq!(
            super::mime_type(Path::new("script.js")),
            Some("text/javascript; charset=utf-8")
        );
        assert_eq!(
            super::mime_type(Path::new("font.woff2")),
            Some("font/woff2")
        );
        assert_eq!(super::mime_type(Path::new("program.exe")), None);
    }

    #[test]
    fn authorizes_only_allowlisted_resources_inside_document_directory() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("page.html");
        let css = dir.path().join("style.css");
        let rejected = dir.path().join("program.exe");
        fs::write(&document, "<p>hello</p>").unwrap();
        fs::write(&css, "p { color: red }").unwrap();
        fs::write(&rejected, "not a resource").unwrap();

        assert_eq!(
            authorize_local_resource(&document, &css, ResourceKind::HtmlAsset).unwrap(),
            css.canonicalize().unwrap(),
        );
        assert!(authorize_local_resource(&document, &rejected, ResourceKind::HtmlAsset).is_err());
        assert!(authorize_local_resource(&document, &css, ResourceKind::Pdf).is_err());
    }

    #[test]
    fn rejects_traversal_and_symlink_escape_for_local_resources() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("docs");
        let outside = dir.path().join("outside.css");
        fs::create_dir(&root).unwrap();
        let document = root.join("page.html");
        let inside = root.join("inside.css");
        fs::write(&document, "<p>hello</p>").unwrap();
        fs::write(&inside, "p { color: red }").unwrap();
        fs::write(&outside, "body {}").unwrap();

        assert!(authorize_local_resource(
            &document,
            &root.join("../outside.css"),
            ResourceKind::HtmlAsset
        )
        .is_err());

        #[cfg(unix)]
        {
            let link = root.join("linked.css");
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            assert!(authorize_local_resource(&document, &link, ResourceKind::HtmlAsset).is_err());
        }
    }
}
