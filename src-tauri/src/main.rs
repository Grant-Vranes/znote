#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::Manager;
mod file_operations;
mod open_requests;
mod recovery;
mod updates;

type Result<T> = std::result::Result<T, String>;
#[derive(Default)]
struct Access {
    root: Option<PathBuf>,
    files: HashSet<PathBuf>,
    directories: HashSet<PathBuf>,
}
struct AppState {
    access: Mutex<Access>,
    recent_files: Mutex<Vec<PathBuf>>,
    worker: Mutex<Option<Worker>>,
    data: PathBuf,
    renderer: PathBuf,
    renderer_args: Vec<PathBuf>,
    recovery: recovery::Recovery,
}
struct Worker {
    child: Child,
    input: ChildStdin,
    output: mpsc::Receiver<String>,
}
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Worker {
    fn start(exe: &Path, args: &[PathBuf]) -> Result<Self> {
        let mut command = Command::new(exe);
        command
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("渲染器启动失败：{e}"))?;
        let input = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, output) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => {
                        if tx.send(line).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            child,
            input,
            output,
        })
    }
    fn request(&mut self, value: Value, timeout: u64) -> Result<Value> {
        writeln!(self.input, "{value}")
            .and_then(|_| self.input.flush())
            .map_err(|e| e.to_string())?;
        let line = self
            .output
            .recv_timeout(Duration::from_secs(timeout))
            .map_err(|_| "渲染器超时或退出；下次预览会自动重启，原文未受影响。".to_string())?;
        let result: Value =
            serde_json::from_str(&line).map_err(|e| format!("渲染协议错误：{e}"))?;
        if let Some(error) = result.get("error").and_then(Value::as_str) {
            return Err(error.to_owned());
        }
        Ok(result)
    }
}
fn request(state: &AppState, value: Value, timeout: u64) -> Result<Value> {
    let mut worker = state.worker.lock().map_err(|e| e.to_string())?;
    if worker.is_none() {
        *worker = Some(Worker::start(&state.renderer, &state.renderer_args)?);
    }
    let result = worker.as_mut().unwrap().request(value, timeout);
    if result.is_err() {
        *worker = None;
    }
    result
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn normalize_existing(path: &str) -> Result<PathBuf> {
    fs::canonicalize(path).map_err(|e| format!("无法访问 {path}：{e}"))
}
fn authorize(state: &AppState, path: &str, new: bool) -> Result<PathBuf> {
    let raw = PathBuf::from(path);
    let canonical = if new && !raw.exists() {
        let parent = raw
            .parent()
            .ok_or("路径缺少父目录")?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        parent.join(raw.file_name().ok_or("文件名为空")?)
    } else {
        normalize_existing(path)?
    };
    let access = state.access.lock().map_err(|e| e.to_string())?;
    if access
        .root
        .as_ref()
        .is_some_and(|root| canonical.starts_with(root))
        || access.directories.iter().any(|root| canonical.starts_with(root))
        || access.files.contains(&canonical)
    {
        Ok(canonical)
    } else {
        Err("路径不在已打开的笔记文件夹内。请通过打开文件或打开文件夹选择。".into())
    }
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("缺少父目录")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
const RECENT_FILES_LIMIT: usize = 10;

fn save_recent_files(state: &AppState, files: &[PathBuf]) -> Result<()> {
    let bytes = serde_json::to_vec(files).map_err(|e| e.to_string())?;
    atomic_write(&state.data.join("recent-files.json"), &bytes)
}

fn remember_recent_path(state: &AppState, path: PathBuf) -> Result<()> {
    let mut files = state.recent_files.lock().map_err(|e| e.to_string())?;
    let mut updated = vec![path.clone()];
    updated.extend(
        files
            .iter()
            .filter(|old| **old != path)
            .take(RECENT_FILES_LIMIT - 1)
            .cloned(),
    );
    save_recent_files(state, &updated)?;
    *files = updated;
    Ok(())
}

#[tauri::command]
fn list_recent_files(state: tauri::State<AppState>) -> Result<Vec<String>> {
    let files = state.recent_files.lock().map_err(|e| e.to_string())?;
    Ok(files
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

#[tauri::command]
fn clear_recent_files(state: tauri::State<AppState>) -> Result<()> {
    clear_recent_paths(&state)
}

fn clear_recent_paths(state: &AppState) -> Result<()> {
    let mut files = state.recent_files.lock().map_err(|e| e.to_string())?;
    save_recent_files(state, &[])?;
    files.clear();
    Ok(())
}

#[tauri::command]
fn remember_recent_file(state: tauri::State<AppState>, path: String) -> Result<()> {
    let path = authorize(&state, &path, false)?;
    remember_recent_path(&state, path)
}

#[tauri::command]
fn open_recent_file(state: tauri::State<AppState>, path: String) -> Result<Document> {
    open_recent_path(&state, &path)
}

fn open_recent_path(state: &AppState, path: &str) -> Result<Document> {
    let saved = state
        .recent_files
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .any(|p| p.to_string_lossy() == path);
    if !saved {
        return Err("文件不在最近打开记录中。".into());
    }
    let canonical = normalize_existing(&path)?;
    if canonical.to_string_lossy() != path {
        return Err("文件路径已改变，请通过打开文件重新选择。".into());
    }
    let doc = read_document(&canonical)?;
    state
        .access
        .lock()
        .map_err(|e| e.to_string())?
        .files
        .insert(canonical.clone());
    remember_recent_path(&state, canonical)?;
    Ok(doc)
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    path: String,
    text: String,
    hash: String,
    bom: bool,
    eol: String,
}
fn read_document(path: &Path) -> Result<Document> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("文件超过 16 MB，请使用专门的大文件编辑器。".into());
    }
    let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let text = std::str::from_utf8(if bom { &bytes[3..] } else { &bytes })
        .map_err(|_| "文件不是有效 UTF-8。为避免破坏原文，请先转换编码。")?
        .to_owned();
    if text.contains('\0') {
        return Err("文件包含二进制内容，无法作为 Markdown 打开。".into());
    }
    let eol = if text.contains("\r\n") { "CRLF" } else { "LF" }.to_owned();
    Ok(Document {
        path: path.to_string_lossy().into(),
        text,
        hash: hash(&bytes),
        bom,
        eol,
    })
}
#[derive(Serialize)]
struct Entry {
    name: String,
    path: String,
    directory: bool,
    children: Vec<Entry>,
}
fn entries(dir: &Path, depth: usize, remaining: &mut usize) -> Vec<Entry> {
    scan_entries(dir, depth, remaining, true)
}
fn scan_entries(dir: &Path, depth: usize, remaining: &mut usize, recursive: bool) -> Vec<Entry> {
    if depth > 12 || *remaining == 0 {
        return vec![];
    }
    let Ok(list) = fs::read_dir(dir) else {
        return vec![];
    };
    let mut result = vec![];
    for item in list.flatten() {
        if *remaining == 0 {
            break;
        }
        let name = item.file_name().to_string_lossy().to_string();
        if name.starts_with('.')
            || ["node_modules", "target", "site", "dist", "__pycache__"].contains(&name.as_str())
        {
            continue;
        }
        let Ok(kind) = item.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        let directory = kind.is_dir();
        let p = item.path();
        *remaining -= 1;
        let children = if directory && recursive {
            scan_entries(&p, depth + 1, remaining, recursive)
        } else {
            vec![]
        };
        result.push(Entry {
            name,
            path: p.to_string_lossy().into(),
            directory,
            children,
        });
    }
    result.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    result
}
fn workspace(state: &AppState, path: PathBuf) -> Result<Value> {
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    if !path.is_dir() {
        return Err("请选择文件夹".into());
    }
    let result = directory_snapshot(&path)?;
    state.access.lock().unwrap().root = Some(path.clone());
    Ok(result)
}
// Independent document folders never replace the explicitly chosen workspace.
#[tauri::command]
async fn document_directory(app: tauri::AppHandle, document: String) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let doc = authorize(&state, &document, false)?;
        let root = doc.parent().ok_or("路径缺少父目录")?.to_path_buf();
        let result = directory_snapshot(&root)?;
        state.access.lock().unwrap().directories.insert(root);
        Ok(result)
    }).await.map_err(|e| e.to_string())?
}
fn directory_snapshot(path: &Path) -> Result<Value> {
    if !path.is_dir() { return Err("请选择文件夹".into()); }
    // Check readability instead of silently returning an empty folder on failure.
    fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut remaining = 6000;
    let tree = scan_entries(path, 0, &mut remaining, false);
    Ok(json!({"root":path.to_string_lossy(),"name":path.file_name().unwrap_or_default().to_string_lossy(),"entries":tree,"truncated":remaining==0}))
}
#[tauri::command]
async fn list_directory(app: tauri::AppHandle, path: String, recursive: Option<bool>) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let path = file_operations::workspace_path(&state, &path, true)?;
        if recursive.unwrap_or(false) {
            let mut remaining = 6000;
            let tree = entries(&path, 0, &mut remaining);
            Ok(json!({"root":path.to_string_lossy(),"name":path.file_name().unwrap_or_default().to_string_lossy(),"entries":tree,"truncated":remaining==0}))
        } else { directory_snapshot(&path) }
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
fn choose_workspace(
    state: tauri::State<AppState>,
    dialog_title: Option<String>,
) -> Result<Option<Value>> {
    rfd::FileDialog::new()
        .set_title(dialog_title.as_deref().unwrap_or("浏览 Markdown 文件夹"))
        .pick_folder()
        .map(|path| workspace(&state, path))
        .transpose()
}
#[tauri::command]
fn restore_workspace(state: tauri::State<AppState>, path: String) -> Result<Value> {
    workspace(&state, PathBuf::from(path))
}
#[tauri::command]
fn refresh_workspace(state: tauri::State<AppState>) -> Result<Value> {
    let root = state
        .access
        .lock()
        .unwrap()
        .root
        .clone()
        .ok_or("尚未打开文件夹")?;
    workspace(&state, root)
}
#[tauri::command]
fn choose_file(
    state: tauri::State<AppState>,
    filter_label: Option<String>,
) -> Result<Option<Document>> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter(
            filter_label.as_deref().unwrap_or("Markdown / 文本"),
            &["md", "markdown", "txt"],
        )
        .pick_file()
    else {
        return Ok(None);
    };
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    state.access.lock().unwrap().files.insert(path.clone());
    read_document(&path).map(Some)
}
#[tauri::command]
fn read_file(state: tauri::State<AppState>, path: String) -> Result<Document> {
    let p = authorize(&state, &path, false)?;
    let doc = read_document(&p)?;
    state.access.lock().unwrap().files.insert(p);
    Ok(doc)
}
#[tauri::command]
fn open_note_link(
    state: tauri::State<AppState>,
    document: String,
    relative: String,
) -> Result<Document> {
    let doc = authorize(&state, &document, false)?;
    if Path::new(&relative).is_absolute()
        || relative.starts_with(['/', '\\'])
        || relative.contains(':')
    {
        return Err("请使用相对于当前文档的 Markdown 链接".into());
    }
    let target = doc
        .parent()
        .unwrap()
        .join(relative)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let mut access = state.access.lock().unwrap();
    let scope = access
        .root
        .as_deref()
        .filter(|r| doc.starts_with(r))
        .unwrap_or(doc.parent().unwrap());
    if !target.starts_with(scope) {
        return Err("链接超出文档范围，请通过打开文件选择目标".into());
    }
    if !matches!(
        target.extension().and_then(|s| s.to_str()),
        Some("md" | "markdown" | "txt")
    ) {
        return Err("此链接不是 Markdown 或文本文件".into());
    }
    let result = read_document(&target)?;
    access.files.insert(target);
    Ok(result)
}
#[tauri::command]
fn file_hash(state: tauri::State<AppState>, path: String) -> Result<String> {
    fs::read(authorize(&state, &path, false)?)
        .map(|b| hash(&b))
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn search_workspace(app: tauri::AppHandle, query: String) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<AppState>();
        let root=state.access.lock().unwrap().root.clone().ok_or("请先打开笔记文件夹")?;
        let needle=query.trim().to_lowercase();
        if needle.is_empty(){return Ok(json!([]));}
        fn visit(items: Vec<Entry>, needle: &str, out: &mut Vec<Value>) {
            for entry in items {
                if out.len()>=200 {break;}
                if entry.directory {visit(entry.children,needle,out);continue;}
                let path=Path::new(&entry.path);
                if !matches!(path.extension().and_then(|s| s.to_str()).map(str::to_ascii_lowercase).as_deref(), Some("md" | "markdown" | "txt")) { continue; }
                if fs::metadata(path).map(|m|m.len()>2*1024*1024).unwrap_or(true){continue;}
                if let Ok(doc)=read_document(path){for (i,line) in doc.text.lines().enumerate(){
                    if line.to_lowercase().contains(needle){out.push(json!({"path":entry.path,"line":i+1,"text":line.chars().take(240).collect::<String>()}));if out.len()>=200{break;}}
                }}
            }
        }
        let mut out=vec![];visit(entries(&root,0,&mut 6000),&needle,&mut out);Ok(Value::Array(out))
    }).await.map_err(|e|e.to_string())?
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Save {
    path: String,
    text: String,
    expected_hash: String,
    bom: bool,
    eol: String,
}
fn save_document(path: &Path, save: &Save) -> Result<Document> {
    let current = if path.exists() {
        hash(&fs::read(path).map_err(|e| e.to_string())?)
    } else {
        "new".into()
    };
    if current != save.expected_hash {
        return Err(
            "CONFLICT:磁盘文件已被其他程序修改。请先比较外部版本，或另存为，避免覆盖。".into(),
        );
    }
    let text = if save.eol == "CRLF" {
        save.text.replace("\r\n", "\n").replace('\n', "\r\n")
    } else {
        save.text.clone()
    };
    let mut bytes = vec![];
    if save.bom {
        bytes.extend([0xef, 0xbb, 0xbf]);
    }
    bytes.extend(text.as_bytes());
    atomic_write(path, &bytes)?;
    read_document(path)
}
#[tauri::command]
fn save_file(state: tauri::State<AppState>, data: Save) -> Result<Document> {
    let path = authorize(&state, &data.path, true)?;
    save_document(&path, &data)
}
#[tauri::command]
fn save_as(state: tauri::State<AppState>, text: String, name: String) -> Result<Option<Document>> {
    let mut dialog = rfd::FileDialog::new()
        .add_filter("Markdown", &["md"])
        .set_file_name(&name);
    if let Some(root) = &state.access.lock().unwrap().root {
        dialog = dialog.set_directory(root);
    }
    let Some(path) = dialog.save_file() else {
        return Ok(None);
    };
    let path = if path.exists() {
        path.canonicalize().map_err(|e| e.to_string())?
    } else {
        path.parent()
            .ok_or("无父目录")?
            .canonicalize()
            .map_err(|e| e.to_string())?
            .join(path.file_name().unwrap())
    };
    let expected_hash = if path.exists() {
        hash(&fs::read(&path).map_err(|e| e.to_string())?)
    } else {
        "new".into()
    };
    state.access.lock().unwrap().files.insert(path.clone());
    save_document(
        &path,
        &Save {
            path: path.to_string_lossy().into(),
            text,
            expected_hash,
            bom: false,
            eol: "LF".into(),
        },
    )
    .map(Some)
}
#[tauri::command]
fn create_note(
    state: tauri::State<AppState>,
    name: String,
    parent: Option<String>,
) -> Result<Document> {
    file_operations::valid_name(&name)?;
    let root = if let Some(parent) = parent {
        file_operations::workspace_path(&state, &parent, true)?
    } else {
        state
            .access
            .lock()
            .unwrap()
            .root
            .clone()
            .ok_or("请先打开文件夹")?
    };
    let name = if name.ends_with(".md") {
        name
    } else {
        format!("{name}.md")
    };
    let path = root.join(&name);
    let file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| format!("无法新建（可能已存在）：{e}"))?;
    file.sync_all().map_err(|e| e.to_string())?;
    state.access.lock().unwrap().files.insert(path.clone());
    read_document(&path)
}
#[tauri::command]
fn read_asset(state: tauri::State<AppState>, document: String, relative: String) -> Result<String> {
    let doc = authorize(&state, &document, false)?;
    let p = doc
        .parent()
        .unwrap()
        .join(&relative)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let access = state.access.lock().unwrap();
    let scope = access
        .root
        .as_deref()
        .filter(|r| doc.starts_with(r))
        .unwrap_or(doc.parent().unwrap());
    if !p.starts_with(scope) {
        return Err("图片在笔记范围外".into());
    }
    let mime = match p
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return Err("不支持的图片格式".into()),
    };
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("图片超过 20 MB".into());
    }
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}
fn image_folder(document: &Path, mode: &str) -> Result<String> {
    match mode {
        "assets" => Ok("assets".into()),
        "same" => Ok(String::new()),
        "document" => Ok(format!("{}.assets", document.file_stem().and_then(|s| s.to_str()).ok_or("无效的笔记路径")?)),
        _ => Err("无效的图片目录规则".into()),
    }
}

#[tauri::command]
fn import_image(
    state: tauri::State<AppState>,
    document: String,
    bytes: Vec<u8>,
    extension: String,
    folder: Option<String>,
    relative: Option<bool>,
) -> Result<String> {
    let doc = authorize(&state, &document, false)?;
    if bytes.is_empty() || bytes.len() > 20 * 1024 * 1024
        || !["png", "jpg", "jpeg", "webp", "gif"].contains(&extension.as_str())
    {
        return Err("请选择 20 MB 以下的常用图片格式".into());
    }
    let folder = image_folder(&doc, folder.as_deref().unwrap_or("assets"))?;
    let dir = doc.parent().unwrap().join(&folder);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dir = dir.canonicalize().map_err(|e| e.to_string())?;
    if !dir.starts_with(doc.parent().unwrap()) {
        return Err("资源目录不能指向笔记目录外".into());
    }
    let name = format!("image-{}.{}", &hash(&bytes)[..16], extension);
    let path = dir.join(&name);
    if !path.exists() {
        atomic_write(&path, &bytes)?;
    }
    if relative.unwrap_or(true) {
        Ok(if folder.is_empty() { name } else { format!("{folder}/{name}") })
    } else {
        // Use the lexical document path rather than Windows canonical \\?\ paths.
        let lexical = document.strip_prefix(r"\\?\").unwrap_or(&document);
        let parent = Path::new(lexical).parent().ok_or("无效的笔记路径")?;
        Ok(parent.join(&folder).join(&name).to_string_lossy().replace('\\', "/"))
    }
}
#[tauri::command]
fn write_recovery(state: tauri::State<AppState>, documents: Value) -> Result<()> {
    state.recovery.write(&documents)
}
#[tauri::command]
fn read_recovery(state: tauri::State<AppState>) -> Value {
    let saved = state.recovery.read();
    // Restore only paths persisted by the previous local editing session.
    if let Some(docs) = saved.as_array() {
        let mut access = state.access.lock().unwrap();
        for doc in docs {
            if let Some(path) = doc.get("path").and_then(Value::as_str) {
                if let Ok(path) = fs::canonicalize(path) {
                    access.files.insert(path);
                }
            }
        }
    }
    saved
}
#[tauri::command]
fn close_workspace(state: tauri::State<AppState>) {
    state.access.lock().unwrap().root = None;
}

#[tauri::command]
async fn render_markdown(
    app: tauri::AppHandle,
    text: String,
    path: Option<String>,
    settings: Value,
    include_effective_config: Option<bool>,
) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let document = path
            .as_ref()
            .map(|p| authorize(&state, p, false))
            .transpose()?;
        request(
            &state,
            json!({"action":"render","text":text,"path":document,"settings":settings,
                   "includeEffectiveConfig":include_effective_config.unwrap_or(false)}),
            30,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn renderer_info(app: tauri::AppHandle) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        request(&app.state::<AppState>(), json!({"action":"info"}), 30)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn open_url(url: String) -> Result<()> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("仅支持 HTTP(S) 链接".into());
    }
    webbrowser::open(&url).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_render_settings(settings: Value, filter_label: Option<String>) -> Result<Option<String>> {
    if settings.get("schemaVersion").and_then(Value::as_u64) != Some(3) {
        return Err("渲染配置版本不受支持。".into());
    }
    let bytes = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
    if bytes.len() > 1048576 {
        return Err("渲染配置超过 1 MB。".into());
    }
    let Some(path) = rfd::FileDialog::new()
        .add_filter(filter_label.as_deref().unwrap_or("渲染配置"), &["json"])
        .set_file_name("znote-render-settings.json")
        .save_file()
    else {
        return Ok(None);
    };
    atomic_write(&path, &bytes)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn main() {
    let launch = open_requests::parse(
        std::env::args_os().skip(1),
        &std::env::current_dir().unwrap_or_default(),
        true,
    );
    let requests = open_requests::OpenRequests::default();
    if let Some(request) = launch.request {
        requests.push(request);
    }
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(requests)
        .manage(open_requests::PendingOpens::default());
    // Explicit new windows keep the existing process-per-window architecture and
    // independent recovery locks. Only the primary instance receives OS requests.
    if !launch.independent {
        builder = builder.plugin(tauri_plugin_single_instance::init(open_requests::receive));
    }
    builder
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            fs::create_dir_all(&data)?;
            let recent_files: Vec<PathBuf> = fs::read(data.join("recent-files.json"))
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                .unwrap_or_default();
            let (bundled, bundled_args) = {
                let renderer = if cfg!(windows) {
                    "bin/znote-renderer/znote-renderer.exe"
                } else {
                    "bin/znote-renderer/znote-renderer"
                };
                (app.path().resource_dir()?.join(renderer), Vec::new())
            };
            let (renderer, renderer_args) = if cfg!(dev) {
                let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
                let python = if cfg!(windows) {
                    root.join(".venv/Scripts/python.exe")
                } else {
                    root.join(".venv/bin/python")
                };
                let script = root.join("python/znote_renderer.py");
                if python.is_file() && script.is_file() {
                    (python, vec![script])
                } else {
                    (bundled, bundled_args)
                }
            } else {
                (bundled, bundled_args)
            };
            let recovery = recovery::Recovery::new(&data)?;
            app.manage(AppState {
                access: Mutex::new(Access::default()),
                recent_files: Mutex::new(
                    recent_files.into_iter().take(RECENT_FILES_LIMIT).collect(),
                ),
                worker: Mutex::new(None),
                data,
                renderer,
                renderer_args,
                recovery,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_requests::pending_open_requests,
            open_requests::complete_open_request,
            open_requests::open_default_apps,
            updates::check_for_updates,
            choose_workspace,
            document_directory,
            list_directory,
            restore_workspace,
            refresh_workspace,
            choose_file,
            read_file,
            list_recent_files,
            clear_recent_files,
            remember_recent_file,
            open_recent_file,
            open_note_link,
            file_hash,
            search_workspace,
            save_file,
            save_as,
            create_note,
            file_operations::create_folder,
            file_operations::rename_entry,
            file_operations::duplicate_note,
            file_operations::trash_entry,
            file_operations::entry_properties,
            file_operations::reveal_entry,
            file_operations::open_in_new_window,
            read_asset,
            import_image,
            write_recovery,
            read_recovery,
            render_markdown,
            close_workspace,
            renderer_info,
            export_render_settings,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("ZNote could not start");
}
