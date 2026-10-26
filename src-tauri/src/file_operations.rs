use super::*;
use std::time::UNIX_EPOCH;

pub(crate) fn valid_name(name: &str) -> Result<()> {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if name.trim().is_empty()
        || name.starts_with('.')
        || name.ends_with(['.', ' '])
        || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        || name.chars().any(char::is_control)
        || reserved.contains(&stem.as_str())
    {
        return Err("请填写有效的名称，不包含路径、保留名称或特殊字符。".into());
    }
    Ok(())
}

pub(crate) fn workspace_path(state: &AppState, path: &str, allow_root: bool) -> Result<PathBuf> {
    let canonical = normalize_existing(path)?;
    let access = state.access.lock().map_err(|e| e.to_string())?;
    let roots = access.root.iter().chain(access.directories.iter());
    let allowed = roots.clone().any(|root| canonical.starts_with(root));
    let is_root = roots.clone().any(|root| canonical == *root);
    if !allowed || (!allow_root && is_root) {
        return Err("只能操作当前笔记文件夹内的项目，不能修改根文件夹。".into());
    }
    Ok(canonical)
}

#[tauri::command]
pub(crate) fn create_folder(
    state: tauri::State<AppState>,
    parent: String,
    name: String,
) -> Result<String> {
    valid_name(&name)?;
    let parent = workspace_path(&state, &parent, true)?;
    if !parent.is_dir() {
        return Err("请选择文件夹".into());
    }
    let path = parent.join(name);
    fs::create_dir(&path).map_err(|e| format!("无法新建（可能已存在）：{e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

pub(crate) fn rename_without_replace(source: &Path, destination: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn MoveFileW(source: *const u16, destination: *const u16) -> i32;
        }
        let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        if unsafe { MoveFileW(source.as_ptr(), destination.as_ptr()) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        if destination.exists() {
            return Err("目标名称已存在，请换一个名称。".into());
        }
        fs::rename(source, destination).map_err(|e| e.to_string())
    }
}

fn update_paths(state: &AppState, source: &Path, destination: Option<&Path>) {
    if let Ok(mut access) = state.access.lock() {
        access.files = access
            .files
            .iter()
            .filter_map(|path| match path.strip_prefix(source) {
                Ok(relative) => destination.map(|target| target.join(relative)),
                Err(_) => Some(path.clone()),
            })
            .collect();
    }
    if let Ok(mut files) = state.recent_files.lock() {
        *files = files
            .iter()
            .filter_map(|path| match path.strip_prefix(source) {
                Ok(relative) => destination.map(|target| target.join(relative)),
                Err(_) => Some(path.clone()),
            })
            .collect();
        // A completed filesystem operation must still be reported as successful
        // if writing the optional recent-history cache fails.
        let _ = save_recent_files(state, &files);
    }
}

pub(crate) fn rename_path(state: &AppState, path: &str, name: &str) -> Result<String> {
    valid_name(name)?;
    let source = workspace_path(state, path, false)?;
    let destination = source.parent().ok_or("缺少父目录")?.join(name);
    if source == destination {
        return Ok(source.to_string_lossy().into_owned());
    }
    rename_without_replace(&source, &destination)?;
    update_paths(state, &source, Some(&destination));
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) fn rename_entry(
    state: tauri::State<AppState>,
    path: String,
    name: String,
) -> Result<String> {
    rename_path(&state, &path, &name)
}

pub(crate) fn duplicate_path(state: &AppState, path: &str, suffix: &str) -> Result<Document> {
    valid_name(suffix)?;
    let source = workspace_path(state, path, false)?;
    if !source.is_file() {
        return Err("请选择一篇笔记文件。".into());
    }
    read_document(&source)?;
    let bytes = fs::read(&source).map_err(|e| e.to_string())?;
    let stem = source.file_stem().unwrap_or_default().to_string_lossy();
    let extension = source
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    for index in 1..=1000 {
        let number = if index == 1 {
            String::new()
        } else {
            format!(" {index}")
        };
        let destination = source
            .parent()
            .ok_or("缺少父目录")?
            .join(format!("{stem} {suffix}{number}{extension}"));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
        {
            Ok(mut file) => {
                file.write_all(&bytes)
                    .and_then(|_| file.sync_all())
                    .map_err(|e| e.to_string())?;
                state
                    .access
                    .lock()
                    .map_err(|e| e.to_string())?
                    .files
                    .insert(destination.clone());
                return read_document(&destination);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("副本名称已用完，请先重命名已有副本。".into())
}

#[tauri::command]
pub(crate) fn duplicate_note(
    state: tauri::State<AppState>,
    path: String,
    suffix: String,
) -> Result<Document> {
    duplicate_path(&state, &path, &suffix)
}

fn dirs_next_home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

fn shell_path(path: &Path) -> String {
    let path = path.to_string_lossy();
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else {
        path.strip_prefix(r"\\?\").unwrap_or(&path).to_owned()
    }
}

#[tauri::command]
pub(crate) fn open_in_new_window(state: tauri::State<AppState>, path: String) -> Result<()> {
    let path = workspace_path(&state, &path, false)?;
    read_document(&path)?;
    open_requests::spawn_window(&[path], "internal")
}

fn recycle(path: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            core::PCWSTR,
            Win32::{System::Com::*, UI::Shell::*},
        };
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                .ok()
                .map_err(|error| error.to_string())?;
            struct Apartment;
            impl Drop for Apartment {
                fn drop(&mut self) {
                    unsafe {
                        CoUninitialize();
                    }
                }
            }
            let _apartment = Apartment;
            let operation: IFileOperation =
                CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)
                    .map_err(|error| error.to_string())?;
            operation
                .SetOperationFlags(
                    FOFX_RECYCLEONDELETE
                        | FOFX_EARLYFAILURE
                        | FOF_NOCONFIRMATION
                        | FOF_NOERRORUI
                        | FOF_SILENT,
                )
                .map_err(|error| error.to_string())?;
            let path: Vec<u16> = std::ffi::OsStr::new(&shell_path(path))
                .encode_wide()
                .chain(Some(0))
                .collect();
            let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(path.as_ptr()), None)
                .map_err(|error| error.to_string())?;
            operation
                .DeleteItem(&item, None)
                .and_then(|_| operation.PerformOperations())
                .map_err(|error| format!("无法移入回收站，操作未完成：{error}"))?;
            if operation
                .GetAnyOperationsAborted()
                .map_err(|error| error.to_string())?
                .as_bool()
            {
                return Err("无法移入回收站，操作已取消。".into());
            }
            Ok(())
        }
    }
    #[cfg(not(windows))]
    {
        #[cfg(target_os = "macos")]
        {
            // macOS has no system-wide trash API in std; move into the user's
            // Trash with a unique suffix to avoid name collisions.
            let filename = path
                .file_name()
                .map(|name| name.to_owned())
                .ok_or_else(|| "无法移入回收站：路径无效。".to_string())?;
            let mut trash = dirs_next_home().join(".Trash");
            if !trash.is_dir() {
                return Err("无法移入回收站：找不到废纸篓目录。".into());
            }
            trash.push(&filename);
            let mut candidate = trash.clone();
            let mut counter = 1u32;
            while candidate.exists() {
                let stem = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| filename.to_string_lossy().into_owned());
                let ext = path
                    .extension()
                    .map(|e| format!(".{}", e.to_string_lossy()))
                    .unwrap_or_default();
                candidate = trash.with_file_name(format!("{stem} {counter}{ext}"));
                counter += 1;
            }
            fs::rename(path, &candidate).map_err(|e| format!("无法移入回收站：{e}"))?;
            return Ok(());
        }
        #[cfg(not(target_os = "macos"))]
        {
            // freedesktop.org environments ship `gio trash` via GLib (GNOME,
            // KDE, Cinnamon and friends all provide it).
            let status = Command::new("gio")
                .arg("trash")
                .arg(path)
                .status()
                .map_err(|e| format!("无法移入回收站：找不到 gio 命令（{e}）。"))?;
            if status.success() {
                Ok(())
            } else {
                Err("无法移入回收站，gio 命令执行失败。".into())
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn trash_entry(state: tauri::State<'_, AppState>, path: String) -> Result<()> {
    let path = workspace_path(&state, &path, false)?;
    let target = path.clone();
    tauri::async_runtime::spawn_blocking(move || recycle(&target))
        .await
        .map_err(|e| e.to_string())??;
    update_paths(&state, &path, None);
    Ok(())
}

#[tauri::command]
pub(crate) fn entry_properties(state: tauri::State<AppState>, path: String) -> Result<Value> {
    let path = workspace_path(&state, &path, true)?;
    let info = fs::metadata(&path).map_err(|e| e.to_string())?;
    let timestamp = |time: std::io::Result<std::time::SystemTime>| {
        time.ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_secs())
    };
    Ok(
        json!({ "path": path.to_string_lossy(), "directory": info.is_dir(), "size": if info.is_dir() { None } else { Some(info.len()) }, "modified": timestamp(info.modified()), "created": timestamp(info.created()) }),
    )
}

#[tauri::command]
pub(crate) fn reveal_entry(state: tauri::State<AppState>, path: String) -> Result<()> {
    let path = workspace_path(&state, &path, true)?;
    #[cfg(windows)]
    {
        Command::new("explorer.exe")
            .arg("/select,")
            .arg(shell_path(&path))
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        #[cfg(target_os = "macos")]
        let program = "open";
        #[cfg(not(target_os = "macos"))]
        let program = "xdg-open";
        Command::new(program).arg(&path).spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
}
