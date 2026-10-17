#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing parent directory")?;
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let temporary = parent.join(format!(
        ".solar-forge-{}-{}.tmp",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| e.to_string())?;
    let result = (|| -> std::io::Result<()> {
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|e| e.to_string())
}

struct RecoveryLock {
    _file: std::fs::File,
}

#[derive(Default)]
struct FileSessions {
    paths: Mutex<HashMap<u64, PathBuf>>,
    next: AtomicU64,
    pending: Mutex<Vec<PathBuf>>,
    recent_lock: Mutex<()>,
}
#[derive(Serialize)]
struct OpenedDocument {
    content: String,
    handle: u64,
    name: String,
}
#[derive(Serialize)]
struct SavedDocument {
    handle: u64,
    name: String,
}
fn register_path(app: &tauri::AppHandle, path: PathBuf) -> Result<SavedDocument, String> {
    let state = app.state::<FileSessions>();
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let mut paths = state.paths.lock().map_err(|e| e.to_string())?;
    let handle = paths
        .iter()
        .find_map(|(id, existing)| if *existing == path { Some(*id) } else { None })
        .unwrap_or_else(|| state.next.fetch_add(1, Ordering::Relaxed));
    paths.insert(handle, path.clone());
    drop(paths);
    remember_path(app, &path)?;
    Ok(SavedDocument { handle, name })
}
fn read_document(path: &Path) -> Result<String, String> {
    let mut content = String::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(10_000_001)
        .read_to_string(&mut content)
        .map_err(|e| e.to_string())?;
    if content.len() > 10_000_000 {
        return Err("Document exceeds 10 MB limit".into());
    }
    Ok(content)
}
#[tauri::command]
async fn open_document(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<Option<OpenedDocument>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("Solar Forge diagram", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let content = read_document(&path)?;
        let saved = register_path(&app, path)?;
        Ok(Some(OpenedDocument {
            content,
            handle: saved.handle,
            name: saved.name,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_document(
    app: tauri::AppHandle,
    window: tauri::Window,
    content: String,
    handle: Option<u64>,
) -> Result<Option<SavedDocument>, String> {
    if content.len() > 10_000_000 {
        return Err("Document exceeds 10 MB limit".into());
    }
    let _: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = if let Some(id) = handle {
            app.state::<FileSessions>()
                .paths
                .lock()
                .map_err(|e| e.to_string())?
                .get(&id)
                .cloned()
                .ok_or("File handle expired. Use Save as.")?
        } else {
            let Some(file) = app
                .dialog()
                .file()
                .set_parent(&window)
                .add_filter("Solar Forge diagram", &["json"])
                .set_file_name("diagram.sforge.json")
                .blocking_save_file()
            else {
                return Ok(None);
            };
            file.into_path().map_err(|e| e.to_string())?
        };
        atomic_write(&path, content.as_bytes())?;
        register_path(&app, path).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn recovery_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory.join("recovery.sforge.json"))
}
#[tauri::command]
async fn read_recovery(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = recovery_path(&app)?;
        if path.exists() {
            read_document(&path).map(Some)
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn write_recovery(app: tauri::AppHandle, content: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = recovery_path(&app)?;
        if let Some(content) = content {
            if content.len() > 10_000_000 {
                return Err("Recovery exceeds 10 MB limit".into());
            }
            let _: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
            atomic_write(&path, content.as_bytes())
        } else {
            match fs::remove_file(path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(e.to_string()),
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Deserialize, Clone)]
struct RecentFile {
    path: PathBuf,
    name: String,
}
fn recent_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(recovery_path(app)?.with_file_name("recent.json"))
}
fn recent_files(app: &tauri::AppHandle) -> Result<Vec<RecentFile>, String> {
    let path = recent_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = read_document(&path)?;
    let files: Vec<RecentFile> = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(files.into_iter().take(20).collect())
}
fn remember_path(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let state = app.state::<FileSessions>();
    let _guard = state.recent_lock.lock().map_err(|e| e.to_string())?;
    let mut files = recent_files(app).unwrap_or_default();
    files.retain(|entry| entry.path != path);
    files.insert(
        0,
        RecentFile {
            path: path.to_path_buf(),
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
        },
    );
    files.truncate(20);
    atomic_write(
        &recent_path(app)?,
        &serde_json::to_vec(&files).map_err(|e| e.to_string())?,
    )
}
#[tauri::command]
async fn recent_documents(app: tauri::AppHandle) -> Result<Vec<RecentFile>, String> {
    tauri::async_runtime::spawn_blocking(move || recent_files(&app))
        .await
        .map_err(|e| e.to_string())?
}
fn open_path(app: &tauri::AppHandle, path: PathBuf) -> Result<OpenedDocument, String> {
    let content = read_document(&path)?;
    let saved = register_path(app, path)?;
    Ok(OpenedDocument {
        content,
        handle: saved.handle,
        name: saved.name,
    })
}
#[tauri::command]
async fn open_recent(app: tauri::AppHandle, path: PathBuf) -> Result<OpenedDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !recent_files(&app)?.iter().any(|entry| entry.path == path) {
            return Err("Unknown recent file".into());
        }
        open_path(&app, path)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn take_pending_file(app: tauri::AppHandle) -> Result<Option<OpenedDocument>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = app
            .state::<FileSessions>()
            .pending
            .lock()
            .map_err(|e| e.to_string())?
            .pop();
        path.map(|path| open_path(&app, path)).transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}
fn queue_arguments(app: &tauri::AppHandle, args: Vec<String>, cwd: &Path) {
    let paths: Vec<PathBuf> = args
        .into_iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .map(|arg| {
            let path = PathBuf::from(arg);
            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
        })
        .collect();
    if let Ok(mut pending) = app.state::<FileSessions>().pending.lock() {
        pending.extend(paths);
    }
    let _ = app.emit("pending-file", ());
}

#[tauri::command]
async fn export_png(
    app: tauri::AppHandle,
    window: tauri::Window,
    bytes: Vec<u8>,
) -> Result<bool, String> {
    if bytes.len() > 50_000_000 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Invalid PNG export".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("PNG image", &["png"])
            .set_file_name("diagram.png")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        atomic_write(&file.into_path().map_err(|e| e.to_string())?, &bytes)?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_gif(
    app: tauri::AppHandle,
    window: tauri::Window,
    request: tauri::ipc::Request<'_>,
) -> Result<bool, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("GIF export requires a binary payload".into());
    };
    if bytes.len() > 50_000_000 || !bytes.starts_with(b"GIF89a") {
        return Err("Invalid GIF export".into());
    }
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("GIF animation", &["gif"])
            .set_file_name("journey.gif")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        atomic_write(&file.into_path().map_err(|e| e.to_string())?, &bytes)?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Put a PNG on the desktop clipboard with the session's clipboard tool.
#[tauri::command]
async fn copy_png(bytes: Vec<u8>) -> Result<(), String> {
    if bytes.len() > 50_000_000 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Invalid PNG image".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
        let (tool, args): (&str, &[&str]) = if wayland {
            ("wl-copy", &["--type", "image/png"])
        } else {
            ("xclip", &["-selection", "clipboard", "-t", "image/png"])
        };
        // The tool forks a helper that keeps serving the clipboard and holds
        // inherited pipes, so wait for the parent only and capture no output.
        let mut child = std::process::Command::new(tool)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Clipboard tool {tool} is unavailable: {e}"))?;
        let mut input = child.stdin.take().ok_or("Clipboard input unavailable")?;
        input.write_all(&bytes).map_err(|e| e.to_string())?;
        drop(input);
        let status = child.wait().map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("{tool} could not copy the image"))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_svg(
    app: tauri::AppHandle,
    window: tauri::Window,
    content: String,
) -> Result<bool, String> {
    if content.len() > 50_000_000 || !content.starts_with("<svg ") {
        return Err("Invalid SVG export".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("SVG image", &["svg"])
            .set_file_name("diagram.svg")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        atomic_write(
            &file.into_path().map_err(|e| e.to_string())?,
            content.as_bytes(),
        )?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn diagnostic_mode() -> bool {
    cfg!(any(debug_assertions, feature = "diagnostics"))
        && std::env::args().any(|arg| arg == "--smoke-test")
}

#[tauri::command]
fn diagnostic_build() -> &'static str {
    if cfg!(debug_assertions) {
        "debug shell / production frontend"
    } else {
        "optimized shell / production frontend / diagnostics feature"
    }
}

#[tauri::command]
fn diagnostic_capture(name: String, bytes: Vec<u8>) -> Result<(), String> {
    if !diagnostic_mode()
        || !matches!(name.as_str(), "isometric" | "top")
        || bytes.len() > 50_000_000
    {
        return Err("Diagnostics unavailable".into());
    }
    let directory = std::env::temp_dir().join("solar-forge-native-smoke");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    atomic_write(&directory.join(format!("{name}.png")), &bytes)
}

#[tauri::command]
fn diagnostic_finish(
    app: tauri::AppHandle,
    report: String,
    document: String,
) -> Result<(), String> {
    if !diagnostic_mode() || report.len() > 100_000 || document.len() > 10_000_000 {
        return Err("Diagnostics unavailable".into());
    }
    let directory = std::env::temp_dir().join("solar-forge-native-smoke");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let path = directory.join("roundtrip.sforge.json");
    atomic_write(&path, document.as_bytes())?;
    if fs::read_to_string(&path).map_err(|e| e.to_string())? != document {
        return Err("Native document roundtrip failed".into());
    }
    atomic_write(&directory.join("report.json"), report.as_bytes())?;
    println!("SOLAR_FORGE_SMOKE {report}");
    app.exit(0);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            queue_arguments(app, args, Path::new(&cwd));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(FileSessions::default())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            fs::create_dir_all(&directory)?;
            let file = OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(directory.join("session.lock"))?;
            file.try_lock()
                .map_err(|_| "Solar Forge Diagrams is already running")?;
            app.manage(RecoveryLock { _file: file });
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                window.with_webview(|webview| {
                    use webkit2gtk::{WebContextExt, WebViewExt};
                    if let Some(context) = webview.inner().context() {
                        context.set_cache_model(webkit2gtk::CacheModel::DocumentViewer);
                    }
                })?;
            }
            queue_arguments(
                app.handle(),
                std::env::args().collect(),
                &std::env::current_dir()?,
            );
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_document,
            save_document,
            export_png,
            export_gif,
            copy_png,
            export_svg,
            read_recovery,
            write_recovery,
            recent_documents,
            open_recent,
            take_pending_file,
            diagnostic_mode,
            diagnostic_build,
            diagnostic_capture,
            diagnostic_finish
        ])
        .run(tauri::generate_context!())
        .expect("failed to launch Solar Forge Diagrams");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_replacement_preserves_complete_documents() {
        let directory =
            std::env::temp_dir().join(format!("solar-forge-atomic-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let target = directory.join("board.json");
        atomic_write(&target, b"old document").unwrap();
        atomic_write(&target, b"replacement document").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"replacement document");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn failed_rename_keeps_existing_target() {
        let directory =
            std::env::temp_dir().join(format!("solar-forge-failure-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let target = directory.join("existing-directory");
        fs::create_dir_all(&target).unwrap();
        assert!(atomic_write(&target, b"replacement").is_err());
        assert!(target.is_dir());
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }
}
