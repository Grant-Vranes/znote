use super::*;
use std::{collections::VecDeque, ffi::OsString, sync::Arc};
use tauri::Emitter;

#[derive(Clone, Default)]
pub(crate) struct OpenRequests(Arc<Mutex<VecDeque<OpenRequest>>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenRequest {
    paths: Vec<PathBuf>,
    source: String,
    initial: bool,
    errors: Vec<String>,
}

pub(crate) struct Launch {
    pub(crate) request: Option<OpenRequest>,
    pub(crate) independent: bool,
}

// Parse OS paths without converting them to UTF-8 or evaluating a shell command.
pub(crate) fn parse(args: impl IntoIterator<Item = OsString>, cwd: &Path, initial: bool) -> Launch {
    let mut paths = Vec::new();
    let mut errors = Vec::new();
    let mut source = "system";
    let mut independent = false;
    let mut positional = false;
    let mut awaiting_note = false;
    for arg in args {
        if !positional && arg == "--new-window" {
            independent = true;
        } else if !positional && arg == "--open-note" {
            source = "internal";
            awaiting_note = true;
        } else if !positional && arg == "--system-open" {
            source = "system";
        } else if !positional && arg == "--" {
            positional = true;
        } else if !positional && arg.to_string_lossy().starts_with('-') {
            errors.push(format!("未知启动参数：{}", arg.to_string_lossy()));
        } else {
            let path = PathBuf::from(arg);
            let path = if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            };
            if !paths.contains(&path) {
                paths.push(path);
            }
            awaiting_note = false;
        }
    }
    if awaiting_note {
        errors.push("--open-note 缺少文件路径".into());
    }
    Launch {
        independent,
        request: (!paths.is_empty() || !errors.is_empty()).then(|| OpenRequest {
            paths,
            source: source.into(),
            initial,
            errors,
        }),
    }
}

impl OpenRequests {
    pub(crate) fn push(&self, request: OpenRequest) {
        self.0.lock().unwrap().push_back(request);
    }
}

pub(crate) fn receive(app: &tauri::AppHandle, args: Vec<String>, cwd: String) {
    let launch = parse(
        args.into_iter().skip(1).map(OsString::from),
        Path::new(&cwd),
        false,
    );
    if let Some(request) = launch.request {
        app.state::<OpenRequests>().push(request);
    }
    // Events only wake the frontend. The queue is authoritative, including requests
    // arriving before the listener is mounted or while another request is handled.
    let _ = app.emit("open-requests-ready", ());
    if let Some(window) = app.get_webview_window("main") {
        // Startup owns the first reveal, including requests received while it
        // is still preparing the initial document and its display mode.
        if window.is_visible().unwrap_or(false) {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenResult {
    pub(crate) files: Vec<file_access::OpenedFile>,
    pub(crate) errors: Vec<String>,
}

// Canonicalize, read, and grant access for user-selected paths. Deduplicates by
// canonical path so repeated selections (startup args, drops) open one tab.
pub(crate) fn open_paths(state: &AppState, paths: Vec<PathBuf>) -> OpenResult {
    let mut files: Vec<file_access::OpenedFile> = Vec::new();
    let mut errors = Vec::new();
    for path in paths {
        let opened: Result<file_access::OpenedFile> = (|| {
            let path = path.canonicalize().map_err(|error| error.to_string())?;
            let opened = file_access::read_opened_file(&path)?;
            state.access.lock().unwrap().files.insert(path);
            Ok(opened)
        })();
        match opened {
            Ok(file) => {
                if !files.iter().any(|old| old.path == file.path) {
                    files.push(file);
                }
            }
            Err(error) => errors.push(format!("{}：{error}", path.display())),
        }
    }
    OpenResult { files, errors }
}

// Paths must originate in the native launch queue. JS receives opaque IDs instead
// of permission to authorize arbitrary filesystem paths.
#[derive(Default)]
pub(crate) struct PendingOpens(Mutex<Vec<Option<OpenRequest>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenTicket {
    id: usize,
    source: String,
    initial: bool,
}

#[tauri::command]
pub(crate) fn pending_open_requests(
    queue: tauri::State<OpenRequests>,
    pending: tauri::State<PendingOpens>,
) -> Vec<OpenTicket> {
    let mut pending = pending.0.lock().unwrap();
    queue
        .0
        .lock()
        .unwrap()
        .drain(..)
        .map(|request| {
            let ticket = OpenTicket {
                id: pending.len(),
                source: request.source.clone(),
                initial: request.initial,
            };
            pending.push(Some(request));
            ticket
        })
        .collect()
}

#[tauri::command]
pub(crate) fn complete_open_request(
    state: tauri::State<AppState>,
    pending: tauri::State<PendingOpens>,
    id: usize,
    new_window: bool,
) -> Result<OpenResult> {
    let request = pending
        .0
        .lock()
        .unwrap()
        .get_mut(id)
        .and_then(Option::take)
        .ok_or("文件打开请求已失效")?;
    if new_window && !request.paths.is_empty() {
        spawn_window(&request.paths, &request.source)?;
        return Ok(OpenResult {
            files: vec![],
            errors: request.errors,
        });
    }
    let mut result = open_paths(&state, request.paths);
    result.errors.splice(0..0, request.errors);
    Ok(result)
}

pub(crate) fn spawn_window(paths: &[PathBuf], source: &str) -> Result<()> {
    let mut command = Command::new(std::env::current_exe().map_err(|error| error.to_string())?);
    command
        .arg("--new-window")
        .arg(if source == "system" {
            "--system-open"
        } else {
            "--open-note"
        })
        .arg("--")
        .args(paths)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.spawn().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn open_default_apps() -> Result<()> {
    webbrowser::open("ms-settings:defaultapps").map_err(|error| error.to_string())
}
