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
async fn open_document(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
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
async fn save_document(app: tauri::AppHandle, content: String) -> Result<bool, String> {
    if content.len() > 10_000_000 {
        return Err("Document exceeds 10 MB limit".into());
    }
    let _: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
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
async fn export_png(app: tauri::AppHandle, bytes: Vec<u8>) -> Result<bool, String> {
    if bytes.len() > 50_000_000 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Invalid PNG export".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_document,
            save_document,
            export_png
        ])
        .run(tauri::generate_context!())
        .expect("failed to launch Solar Forge Diagrams");
}
