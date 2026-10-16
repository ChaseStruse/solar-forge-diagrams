#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use tauri_plugin_dialog::DialogExt;

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing parent directory")?;
    let temporary = parent.join(format!(".solar-forge-{}.tmp", std::process::id()));
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

#[tauri::command]
async fn open_document(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<Option<String>, String> {
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
        let mut content = String::new();
        fs::File::open(path)
            .map_err(|e| e.to_string())?
            .take(10_000_001)
            .read_to_string(&mut content)
            .map_err(|e| e.to_string())?;
        if content.len() > 10_000_000 {
            return Err("Document exceeds 10 MB limit".into());
        }
        Ok(Some(content))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_document(
    app: tauri::AppHandle,
    window: tauri::Window,
    content: String,
) -> Result<bool, String> {
    if content.len() > 10_000_000 {
        return Err("Document exceeds 10 MB limit".into());
    }
    let _: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("Solar Forge diagram", &["json"])
            .set_file_name("diagram.sforge.json")
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_document,
            save_document,
            export_png,
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
